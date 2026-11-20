"""Folder scanning, tag reading and the background analysis queue."""
from __future__ import annotations

import logging
import os
import queue
import re
import threading
import traceback
from pathlib import Path

from . import analysis, cues
from .audio import AUDIO_EXT
from .db import DB

log = logging.getLogger("subset.library")


def read_tags(path: str) -> dict:
    tags = {}
    try:
        import mutagen
        f = mutagen.File(path, easy=True)
        if f is not None and f.tags is not None:
            for k in ("artist", "title", "album"):
                v = f.tags.get(k)
                if v:
                    tags[k] = str(v[0])
    except Exception:
        pass
    if not tags.get("title"):
        stem = Path(path).stem
        stem = re.sub(r"^\d+[\s._-]+", "", stem)  # leading track numbers
        if " - " in stem:
            a, t = stem.split(" - ", 1)
            tags.setdefault("artist", a.strip())
            tags["title"] = t.strip()
        else:
            tags["title"] = stem
    return tags


class Library:
    def __init__(self, db: DB):
        self.db = db
        self.q: queue.Queue[int] = queue.Queue()
        self.current: int | None = None
        self.done = 0
        self.total = 0
        self.template = cues.DEFAULT_TEMPLATE
        t = threading.Thread(target=self._worker, daemon=True)
        t.start()
        for tid in db.pending():
            self.enqueue(tid)

    def enqueue(self, tid: int):
        self.total += 1
        self.q.put(tid)

    def scan(self, folder: str) -> dict:
        folder = os.path.abspath(folder)
        self.db.add_folder(folder)
        found = new = 0
        for root, _, files in os.walk(folder):
            for fn in files:
                if Path(fn).suffix.lower() not in AUDIO_EXT or fn.startswith("._"):
                    continue
                p = os.path.join(root, fn)
                st = os.stat(p)
                tid, need = self.db.upsert_file(p, st.st_mtime, st.st_size, read_tags(p))
                found += 1
                if need:
                    new += 1
                    self.enqueue(tid)
        return {"found": found, "new": new}

    def add_file(self, p: str) -> int:
        st = os.stat(p)
        tid, need = self.db.upsert_file(os.path.abspath(p), st.st_mtime, st.st_size, read_tags(p))
        if need:
            self.enqueue(tid)
        return tid

    def status(self) -> dict:
        return {"queued": self.q.qsize(), "current": self.current, "done": self.done, "total": self.total,
                "engine": analysis.engine_status()}

    def _worker(self):
        while True:
            tid = self.q.get()
            self.current = tid
            t = self.db.track(tid, full=False)
            if not t:
                continue
            try:
                self.db.set_status(tid, "analyzing")
                a = analysis.analyze(t["path"])
                self.db.save_analysis(tid, a, cues.generate(a, self.template))
            except Exception as e:
                log.error("Analiza nije uspela za %s: %s", t["path"], traceback.format_exc())
                self.db.set_status(tid, "error", str(e))
            finally:
                self.done += 1
                self.current = None
                if self.q.empty():
                    self.done = self.total = 0
