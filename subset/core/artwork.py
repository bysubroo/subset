"""Embedded cover art extraction (ID3 APIC, FLAC/OGG pictures, MP4 covr) -> cached 160px JPEG."""
from __future__ import annotations

import io
from pathlib import Path

from .db import data_dir

ART_DIR = data_dir() / "art"
ART_DIR.mkdir(exist_ok=True)
_MISSING = set()


def _raw(path: str) -> bytes | None:
    import mutagen
    f = mutagen.File(path)
    if f is None:
        return None
    pics = getattr(f, "pictures", None)
    if pics:
        return pics[0].data
    tags = f.tags
    if tags is None:
        return None
    try:
        for k in tags.keys():
            if str(k).startswith("APIC"):
                return tags[k].data
    except Exception:
        pass
    covr = tags.get("covr") if hasattr(tags, "get") else None
    if covr:
        return bytes(covr[0])
    return None


def get(tid: int, path: str) -> Path | None:
    out = ART_DIR / f"{tid}.jpg"
    if out.exists():
        return out
    if tid in _MISSING:
        return None
    try:
        data = _raw(path)
        if not data:
            _MISSING.add(tid)
            return None
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGB")
        im.thumbnail((320, 320))
        im.save(out, "JPEG", quality=86)
        return out
    except Exception:
        _MISSING.add(tid)
        return None
