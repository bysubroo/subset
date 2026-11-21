"""SQLite library: tracks with cached analysis, and saved sets."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path


def data_dir() -> Path:
    base = os.environ.get("SUBSET_DATA") or os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    d = Path(base) / "SubSet"
    d.mkdir(parents=True, exist_ok=True)
    return d


def make_preview(a: dict, n: int = 160) -> dict:
    """Small 3-band overview (n points) for table rows and lanes."""
    wf = a.get("waveform") or {}
    out = {}
    for band in ("low", "mid", "high"):
        v = wf.get(band) or []
        if not v:
            out[band] = []
            continue
        step = len(v) / n
        out[band] = [max(v[int(i * step):max(int(i * step) + 1, int((i + 1) * step))]) for i in range(n)]
    return out


class DB:
    def __init__(self, path: Path | None = None):
        self.path = path or data_dir() / "library.db"
        self.lock = threading.RLock()
        self.con = sqlite3.connect(str(self.path), check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.executescript(
            """
            CREATE TABLE IF NOT EXISTS tracks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE, mtime REAL, size INTEGER,
                artist TEXT, title TEXT, album TEXT, duration REAL,
                bpm REAL, key TEXT, camelot TEXT, energy INTEGER,
                status TEXT DEFAULT 'new', error TEXT,
                analysis TEXT, cues TEXT, added REAL DEFAULT (strftime('%s','now'))
            );
            CREATE TABLE IF NOT EXISTS sets(
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, data TEXT,
                updated REAL DEFAULT (strftime('%s','now'))
            );
            CREATE TABLE IF NOT EXISTS folders(path TEXT PRIMARY KEY);
            """
        )
        cols = {r[1] for r in self.con.execute("PRAGMA table_info(tracks)")}
        if "preview" not in cols:
            self.con.execute("ALTER TABLE tracks ADD COLUMN preview TEXT")
        self.con.commit()
        self._backfill_previews()

    def _backfill_previews(self):
        rows = self.con.execute("SELECT id, analysis FROM tracks WHERE preview IS NULL AND analysis IS NOT NULL").fetchall()
        for r in rows:
            try:
                self.con.execute("UPDATE tracks SET preview=? WHERE id=?", (json.dumps(make_preview(json.loads(r["analysis"]))), r["id"]))
            except Exception:
                pass
        self.con.commit()

    # ---------------- tracks
    def upsert_file(self, path: str, mtime: float, size: int, tags: dict) -> tuple[int, bool]:
        """Returns (id, needs_analysis)."""
        with self.lock:
            r = self.con.execute("SELECT id, mtime, size, status FROM tracks WHERE path=?", (path,)).fetchone()
            if r and abs(r["mtime"] - mtime) < 1 and r["size"] == size and r["status"] == "ok":
                return r["id"], False
            if r:
                self.con.execute("UPDATE tracks SET mtime=?, size=?, artist=?, title=?, album=?, status='new' WHERE id=?",
                                 (mtime, size, tags.get("artist"), tags.get("title"), tags.get("album"), r["id"]))
                self.con.commit()
                return r["id"], True
            cur = self.con.execute("INSERT INTO tracks(path, mtime, size, artist, title, album) VALUES(?,?,?,?,?,?)",
                                   (path, mtime, size, tags.get("artist"), tags.get("title"), tags.get("album")))
            self.con.commit()
            return cur.lastrowid, True

    def set_status(self, tid: int, status: str, error: str | None = None):
        with self.lock:
            self.con.execute("UPDATE tracks SET status=?, error=? WHERE id=?", (status, error, tid))
            self.con.commit()

    def save_analysis(self, tid: int, a: dict, cues: list):
        with self.lock:
            self.con.execute(
                "UPDATE tracks SET analysis=?, cues=?, bpm=?, key=?, camelot=?, energy=?, duration=?, preview=?, status='ok', error=NULL WHERE id=?",
                (json.dumps(a), json.dumps(cues), a["bpm"], a["key"], a["camelot"], a["energy"], a["duration"], json.dumps(make_preview(a)), tid))
            self.con.commit()

    def save_cues(self, tid: int, cues: list):
        with self.lock:
            self.con.execute("UPDATE tracks SET cues=? WHERE id=?", (json.dumps(cues), tid))
            self.con.commit()

    def save_analysis_only(self, tid: int, a: dict):
        with self.lock:
            self.con.execute("UPDATE tracks SET analysis=?, bpm=? WHERE id=?", (json.dumps(a), a["bpm"], tid))
            self.con.commit()

    def tracks(self) -> list[dict]:
        with self.lock:
            rows = self.con.execute(
                "SELECT id, path, artist, title, album, duration, bpm, key, camelot, energy, status, error, preview, cues, added FROM tracks ORDER BY artist, title"
            ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["preview"] = json.loads(d["preview"]) if d["preview"] else None
            d["cues"] = [c for c in json.loads(d["cues"]) if c.get("type") == "hot"] if d["cues"] else []
            out.append(d)
        return out

    def track(self, tid: int, full: bool = True) -> dict | None:
        with self.lock:
            r = self.con.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["analysis"] = json.loads(d["analysis"]) if d["analysis"] else None
        d["cues"] = json.loads(d["cues"]) if d["cues"] else []
        if not full and d["analysis"]:
            d["analysis"].pop("waveform", None)
        return d

    def pending(self) -> list[int]:
        with self.lock:
            return [r[0] for r in self.con.execute("SELECT id FROM tracks WHERE status IN ('new','error_retry')")]

    def remove_missing(self):
        with self.lock:
            for r in self.con.execute("SELECT id, path FROM tracks").fetchall():
                if not os.path.exists(r["path"]):
                    self.con.execute("DELETE FROM tracks WHERE id=?", (r["id"],))
            self.con.commit()

    # ---------------- folders
    def add_folder(self, p: str):
        with self.lock:
            self.con.execute("INSERT OR IGNORE INTO folders(path) VALUES(?)", (p,))
            self.con.commit()

    def folders(self) -> list[str]:
        with self.lock:
            return [r[0] for r in self.con.execute("SELECT path FROM folders")]

    # ---------------- sets
    def save_set(self, data: dict, sid: int | None = None) -> int:
        with self.lock:
            if sid:
                self.con.execute("UPDATE sets SET name=?, data=?, updated=strftime('%s','now') WHERE id=?",
                                 (data.get("name", "Set"), json.dumps(data), sid))
                self.con.commit()
                return sid
            cur = self.con.execute("INSERT INTO sets(name, data) VALUES(?,?)", (data.get("name", "Set"), json.dumps(data)))
            self.con.commit()
            return cur.lastrowid

    def sets(self) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.con.execute("SELECT id, name, updated FROM sets ORDER BY updated DESC")]

    def get_set(self, sid: int) -> dict | None:
        with self.lock:
            r = self.con.execute("SELECT * FROM sets WHERE id=?", (sid,)).fetchone()
        if not r:
            return None
        d = json.loads(r["data"])
        d["id"] = r["id"]
        return d

    def delete_set(self, sid: int):
        with self.lock:
            self.con.execute("DELETE FROM sets WHERE id=?", (sid,))
            self.con.commit()
