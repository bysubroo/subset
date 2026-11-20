"""Set list import (Spotify link or plain text) and matching against the local library."""
from __future__ import annotations

import json
import re
import unicodedata

from rapidfuzz import fuzz

VERSION_WORDS = ["remix", "edit", "extended", "instrumental", "acapella", "a cappella", "vip", "bootleg",
                 "mashup", "intro", "clean", "dirty", "radio", "rework", "flip", "live", "version", "mix"]

_SR = str.maketrans({"đ": "dj", "Đ": "dj", "ð": "d"})


def norm(s: str | None) -> str:
    s = (s or "").translate(_SR)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\b(feat|ft|featuring|prod|x)\b\.?", " ", s)
    s = re.sub(r"[\(\)\[\]\{\}_\-–—.,'\"!?&+/]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_version(title: str) -> str:
    return re.sub(r"[\(\[][^\)\]]*[\)\]]", "", title or "").strip()


# ------------------------------------------------------------------ Spotify

def spotify_id(url: str) -> tuple[str, str] | None:
    m = re.search(r"(playlist|album)[/:]([A-Za-z0-9]{22})", url or "")
    return (m.group(1), m.group(2)) if m else None


def fetch_spotify(url: str) -> list[dict]:
    """Reads a public Spotify playlist/album via the public embed page (no login/API key needed)."""
    import requests
    kind, pid = spotify_id(url)
    r = requests.get(f"https://open.spotify.com/embed/{kind}/{pid}", timeout=20,
                     headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"})
    r.raise_for_status()
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', r.text, re.S)
    if not m:
        raise RuntimeError("Spotify stranica nema listu pesama (promenjen format?) - nalepi tracklistu kao tekst.")
    data = json.loads(m.group(1))
    entity = _find(data, "trackList")
    name = _find(data, "name") or "Spotify set"
    out = []
    for t in entity or []:
        out.append({"title": t.get("title", ""), "artist": t.get("subtitle", "").replace(" ", " "),
                    "duration": (t.get("duration") or 0) / 1000.0})
    if not out:
        raise RuntimeError("Nisam nasao pesme u plejlisti. Da li je javna?")
    return out, name


def _find(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            r = _find(v, key)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find(v, key)
            if r is not None:
                return r
    return None


# ------------------------------------------------------------------ text

def parse_text(text: str) -> list[dict]:
    """One track per line: 'Artist - Title', optional '| note' at the end (e.g. '| remix')."""
    out = []
    for line in (text or "").splitlines():
        line = re.sub(r"^\s*\d+[\.\)]\s*", "", line).strip()
        if not line:
            continue
        note = ""
        if "|" in line:
            line, note = [x.strip() for x in line.split("|", 1)]
        if " - " in line:
            artist, title = [x.strip() for x in line.split(" - ", 1)]
        elif " – " in line:
            artist, title = [x.strip() for x in line.split(" – ", 1)]
        else:
            artist, title = "", line
        out.append({"artist": artist, "title": title, "note": note})
    return out


# ------------------------------------------------------------------ matching

def _version_of(text: str) -> set[str]:
    t = norm(text)
    return {w for w in VERSION_WORDS if re.search(r"\b" + re.escape(w) + r"\b", t)}


def score(item: dict, track: dict, want_version: str = "") -> float:
    q_title = norm(strip_version(item.get("title")))
    q_artist = norm(item.get("artist"))
    fname = track.get("path", "").replace("\\", "/").rsplit("/", 1)[-1].rsplit(".", 1)[0]
    t_title = norm(strip_version(track.get("title") or ""))
    t_artist = norm(track.get("artist") or "")
    s_title = max(fuzz.token_set_ratio(q_title, t_title), fuzz.partial_ratio(q_title, norm(fname)))
    s_artist = fuzz.token_set_ratio(q_artist, t_artist + " " + norm(fname)) if q_artist else 70
    s = 0.7 * s_title + 0.3 * s_artist
    have = _version_of((track.get("title") or "") + " " + fname)
    want = _version_of(want_version) if want_version else set()
    want_from_title = _version_of(item.get("title", ""))
    want |= want_from_title
    if want:
        s += 12 if want & have else -10
    elif have - {"mix", "version", "clean", "dirty", "radio"}:
        s -= 8  # asked for the original, file is a remix/edit
    return s


def match(items: list[dict], tracks: list[dict], threshold: float = 72) -> list[dict]:
    """Annotates each item with best match + alternatives. Duplicate songs get a 'remix' suggestion on 2nd play."""
    seen = {}
    res = []
    for i, it in enumerate(items):
        k = norm(strip_version(it.get("title"))) + "|" + norm(it.get("artist"))
        seen[k] = seen.get(k, 0) + 1
        note = it.get("note", "")
        dup = seen[k] > 1
        if dup and not note:
            note = "remix"
        cands = sorted(((score(it, t, note), t) for t in tracks), key=lambda x: -x[0])[:5]
        best = cands[0] if cands and cands[0][0] >= threshold else None
        res.append({
            **it, "pos": i, "note": note, "duplicate": dup,
            "track_id": best[1]["id"] if best else None,
            "score": round(best[0], 1) if best else None,
            "alternatives": [{"id": t["id"], "label": f"{t.get('artist') or ''} - {t.get('title') or ''}".strip(" -"),
                              "score": round(s, 1)} for s, t in cands if s >= threshold - 25],
        })
    return res
