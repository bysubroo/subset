"""Cue templates. Default = Marko's layout: A green (mix-in), B yellow (first drop/chorus), C red (mix-out)."""
from __future__ import annotations

# rekordbox hot-cue palette (approx. RGB)
COLORS = {
    "green": (40, 226, 20),
    "yellow": (195, 175, 4),
    "red": (230, 40, 40),
    "blue": (48, 90, 255),
    "orange": (224, 100, 27),
    "pink": (222, 68, 207),
    "aqua": (16, 177, 118),
    "purple": (180, 50, 255),
}

PHRASE_COLORS = {
    "intro": "blue", "verse": "aqua", "build": "orange", "drop": "red",
    "chorus": "pink", "break": "purple", "outro": "blue",
}

DEFAULT_TEMPLATE = {
    "name": "SubRoo standard",
    "hot": [
        {"slot": "A", "point": "mix_in", "color": "green", "name": "MIX IN"},
        {"slot": "B", "point": "first_peak", "color": "yellow", "name": "DROP"},
        {"slot": "C", "point": "mix_out", "color": "red", "name": "MIX OUT"},
    ],
    "memory_on_phrases": True,
}

CLUB_TEMPLATE = {
    "name": "Klub",
    "hot": [
        {"slot": "A", "point": "mix_in", "color": "green", "name": "MIX IN"},
        {"slot": "B", "point": "first_peak", "color": "yellow", "name": "DROP 1"},
        {"slot": "C", "point": "mix_out", "color": "red", "name": "MIX OUT"},
        {"slot": "D", "point": "second_peak", "color": "orange", "name": "DROP 2"},
        {"slot": "E", "point": "first_break", "color": "purple", "name": "BREAK"},
    ],
    "memory_on_phrases": True,
}

TEMPLATES = {"standard": DEFAULT_TEMPLATE, "club": CLUB_TEMPLATE}


def _points(a: dict) -> dict:
    ph = a.get("phrases", [])
    dbs = a["grid"].get("downbeats") or [0.0]
    pts = {"mix_in": dbs[0]}
    peaks = [p for p in ph if p["label"] in ("drop", "chorus")]
    if peaks:
        pts["first_peak"] = peaks[0]["start"]
    elif len(ph) > 1:
        pts["first_peak"] = ph[1]["start"]
    if len(peaks) > 1:
        pts["second_peak"] = peaks[1]["start"]
    breaks = [p for p in ph if p["label"] == "break"]
    if breaks:
        pts["first_break"] = breaks[0]["start"]
    outro = [p for p in ph if p["label"] == "outro"]
    if outro:
        pts["mix_out"] = outro[-1]["start"]
    else:
        pts["mix_out"] = dbs[max(0, len(dbs) - 17)]
    return pts


def generate(a: dict, template: dict | None = None) -> list[dict]:
    t = template or DEFAULT_TEMPLATE
    pts = _points(a)
    cues = []
    for i, h in enumerate(t["hot"]):
        if h["point"] in pts:
            cues.append({"type": "hot", "num": "ABCDEFGH".index(h["slot"]), "slot": h["slot"],
                         "time": round(max(0.0, float(pts[h["point"]])), 4), "color": COLORS[h["color"]], "name": h["name"]})
    if t.get("memory_on_phrases"):
        for p in a.get("phrases", [])[:10]:
            cues.append({"type": "memory", "num": -1, "time": round(max(0.0, float(p["start"])), 4),
                         "color": COLORS[PHRASE_COLORS.get(p["label"], "blue")], "name": p["label"].upper()})
    return cues
