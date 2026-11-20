"""rekordbox XML export: playlist + beatgrid + colored hot/memory cues.

Import in rekordbox: Preferences > Advanced > Database > rekordbox xml -> choose this file,
then in the browser sidebar open 'rekordbox xml', right-click the playlist -> Import Playlist.
"""
from __future__ import annotations

import pathlib
import urllib.parse
import xml.etree.ElementTree as ET

KEY_RB = {"Eb": "Eb", "Ebm": "Ebm"}  # rekordbox accepts classic notation as-is


def _location(path: str) -> str:
    p = pathlib.Path(path).resolve().as_posix()
    if not p.startswith("/"):
        p = "/" + p  # Windows: /C:/...
    return "file://localhost" + urllib.parse.quote(p, safe="/:")


def _tempo_elems(trk: ET.Element, a: dict):
    g = a["grid"]
    bpm = a["bpm"]
    T = 60.0 / bpm
    first = g["first_downbeat"]
    beat_in_bar = 1
    while first < 0:
        first += T
        beat_in_bar += 1
    if g["type"] == "constant":
        ET.SubElement(trk, "TEMPO", Inizio=f"{first:.3f}", Bpm=f"{bpm:.2f}", Metro="4/4", Battito=str(beat_in_bar))
    else:
        dbs = [d for d in g.get("downbeats", []) if d >= 0]
        for d0, d1 in zip(dbs, dbs[1:]):
            ET.SubElement(trk, "TEMPO", Inizio=f"{d0:.3f}", Bpm=f"{240.0 / (d1 - d0):.2f}", Metro="4/4", Battito="1")


def build(set_name: str, tracks: list[dict]) -> bytes:
    """tracks: list of {id, path, artist, title, analysis, cues} in playlist order (duplicates allowed)."""
    root = ET.Element("DJ_PLAYLISTS", Version="1.0.0")
    ET.SubElement(root, "PRODUCT", Name="SubSet", Version="0.1", Company="SubRoo")
    uniq = {}
    for t in tracks:
        uniq.setdefault(t["id"], t)
    coll = ET.SubElement(root, "COLLECTION", Entries=str(len(uniq)))
    for t in uniq.values():
        a = t["analysis"]
        trk = ET.SubElement(coll, "TRACK", TrackID=str(t["id"]), Name=t.get("title") or "", Artist=t.get("artist") or "",
                            Album=t.get("album") or "", Kind="Audio File", TotalTime=str(int(a["duration"])),
                            AverageBpm=f"{a['bpm']:.2f}", Tonality=a.get("key") or "", Location=_location(t["path"]),
                            Comments=f"SubSet | {a.get('camelot', '')} | E{a.get('energy', '')}")
        _tempo_elems(trk, a)
        for c in t.get("cues", []):
            r, g, b = c.get("color", (40, 226, 20))
            ET.SubElement(trk, "POSITION_MARK", Name=c.get("name", ""), Type="0", Start=f"{c['time']:.3f}",
                          Num=str(c["num"]), Red=str(r), Green=str(g), Blue=str(b))
    pls = ET.SubElement(root, "PLAYLISTS")
    rootnode = ET.SubElement(pls, "NODE", Type="0", Name="ROOT", Count="1")
    folder = ET.SubElement(rootnode, "NODE", Type="0", Name="SubSet", Count="1")
    pl = ET.SubElement(folder, "NODE", Name=set_name, Type="1", KeyType="0", Entries=str(len(tracks)))
    for t in tracks:
        ET.SubElement(pl, "TRACK", Key=str(t["id"]))
    ET.indent(root)
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8")
