"""SubSet local API server (FastAPI). UI is served from /web."""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .core import cues as cues_mod, export_rekordbox, harmonize, mixer, playlist
from .core.db import DB, data_dir
from .core.library import Library

log = logging.getLogger("subset")
WEB = Path(__file__).parent / "web"

db = DB()
lib = Library(db)
app = FastAPI(title="SubSet")
jobs: dict[str, dict] = {}
picker = {"fn": None}  # set by the desktop window (pywebview) for native folder dialogs

SETTINGS_PATH = data_dir() / "settings.json"


def default_out() -> str:
    d = Path.home() / "Documents" / "SubSet"
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def load_settings() -> dict:
    s = {"export_dir": default_out(), "sfx_dir": "", "cue_template": "standard"}
    if SETTINGS_PATH.exists():
        try:
            s.update(json.loads(SETTINGS_PATH.read_text("utf-8")))
        except Exception:
            pass
    return s


def save_settings(s: dict):
    SETTINGS_PATH.write_text(json.dumps(s, indent=2), "utf-8")


settings = load_settings()
lib.template = cues_mod.TEMPLATES.get(settings.get("cue_template"), cues_mod.DEFAULT_TEMPLATE)


def safe_name(s: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', "_", s).strip() or "SubSet"


def run_job(kind: str, fn) -> str:
    jid = uuid.uuid4().hex[:10]
    jobs[jid] = {"id": jid, "kind": kind, "status": "running", "progress": 0.0, "msg": "", "result": None}

    def prog(i, n, msg=None):
        jobs[jid]["progress"] = i / max(n, 1)
        jobs[jid]["msg"] = msg or ""

    def target():
        try:
            jobs[jid]["result"] = fn(prog)
            jobs[jid]["status"] = "done"
            jobs[jid]["progress"] = 1.0
        except Exception as e:
            log.error(traceback.format_exc())
            jobs[jid]["status"] = "error"
            jobs[jid]["msg"] = str(e)

    threading.Thread(target=target, daemon=True).start()
    return jid


# ---------------------------------------------------------------- library

@app.get("/api/status")
def status():
    from . import __version__
    return {"version": __version__, "library": lib.status(), "folders": db.folders(), "settings": settings, "can_pick": picker["fn"] is not None}


@app.get("/api/tracks")
def tracks():
    return db.tracks()


@app.get("/api/tracks/{tid}")
def track(tid: int):
    t = db.track(tid)
    if not t:
        raise HTTPException(404)
    return t


@app.post("/api/tracks/{tid}/reanalyze")
def reanalyze(tid: int):
    db.set_status(tid, "new")
    lib.enqueue(tid)
    return {"ok": True}


@app.put("/api/tracks/{tid}/cues")
def put_cues(tid: int, body: list = Body(...)):
    db.save_cues(tid, body)
    return {"ok": True}


@app.post("/api/tracks/{tid}/regen_cues")
def regen_cues(tid: int):
    t = db.track(tid)
    c = cues_mod.generate(t["analysis"], lib.template)
    db.save_cues(tid, c)
    return c


@app.get("/api/audio/{tid}")
def audio_file(tid: int):
    t = db.track(tid, full=False)
    if not t or not os.path.exists(t["path"]):
        raise HTTPException(404)
    return FileResponse(t["path"])


@app.post("/api/pick_folder")
def pick_folder():
    if picker["fn"] is None:
        return {"path": None}
    return {"path": picker["fn"]()}


@app.post("/api/scan")
def scan(body: dict = Body(...)):
    p = body.get("path")
    if not p or not os.path.isdir(p):
        raise HTTPException(400, "Folder ne postoji")
    return lib.scan(p)


@app.post("/api/rescan")
def rescan():
    db.remove_missing()
    res = {"found": 0, "new": 0}
    for f in db.folders():
        if os.path.isdir(f):
            r = lib.scan(f)
            res["found"] += r["found"]; res["new"] += r["new"]
    return res


@app.get("/api/settings")
def get_settings():
    return settings


@app.put("/api/settings")
def put_settings(body: dict = Body(...)):
    settings.update(body)
    save_settings(settings)
    lib.template = cues_mod.TEMPLATES.get(settings.get("cue_template"), cues_mod.DEFAULT_TEMPLATE)
    return settings


@app.get("/api/sfx")
def sfx_list():
    d = settings.get("sfx_dir")
    if not d or not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d) if Path(f).suffix.lower() in {".wav", ".mp3", ".flac", ".aif", ".aiff"})


# ---------------------------------------------------------------- import / match

@app.post("/api/import")
def import_list(body: dict = Body(...)):
    src = (body.get("source") or "").strip()
    name = body.get("name") or ""
    if playlist.spotify_id(src):
        try:
            items, pname = playlist.fetch_spotify(src)
        except Exception as e:
            raise HTTPException(400, f"Spotify: {e}")
        name = name or pname
    else:
        items = playlist.parse_text(src)
    if not items:
        raise HTTPException(400, "Prazna lista")
    return {"name": name or "Novi set", "items": playlist.match(items, db.tracks())}


@app.post("/api/match")
def rematch(body: dict = Body(...)):
    items = body.get("items") or []
    matched = playlist.match(items, db.tracks())
    # keep manual choices
    for old, new in zip(items, matched):
        if old.get("manual") and old.get("track_id"):
            new["track_id"] = old["track_id"]; new["manual"] = True
    return matched


# ---------------------------------------------------------------- sets

def _full_tracks(set_data: dict) -> dict:
    out = {}
    for it in set_data.get("items", []):
        tid = it.get("track_id")
        if tid and tid not in out:
            t = db.track(tid)
            if t and t.get("analysis"):
                t["analysis"].pop("waveform", None)
                out[tid] = t
    return out


@app.get("/api/sets")
def sets():
    return db.sets()


@app.post("/api/sets")
def create_set(body: dict = Body(...)):
    body.setdefault("settings", {})
    body.setdefault("transitions", [])
    sid = db.save_set(body)
    return {"id": sid}


@app.get("/api/sets/{sid}")
def get_set(sid: int):
    s = db.get_set(sid)
    if not s:
        raise HTTPException(404)
    return s


@app.put("/api/sets/{sid}")
def put_set(sid: int, body: dict = Body(...)):
    db.save_set(body, sid)
    return {"ok": True}


@app.delete("/api/sets/{sid}")
def del_set(sid: int):
    db.delete_set(sid)
    return {"ok": True}


@app.get("/api/sets/{sid}/plan")
def set_plan(sid: int):
    s = db.get_set(sid)
    if not s:
        raise HTTPException(404)
    ft = _full_tracks(s)
    pending = [it for it in s["items"] if it.get("track_id") and it["track_id"] not in ft]
    pl = mixer.plan(s, ft)
    pl["pending"] = len(pending)
    return pl


@app.post("/api/sets/{sid}/harmonize")
def set_harmonize(sid: int, body: dict = Body(...)):
    s = db.get_set(sid)
    ft = _full_tracks(s)
    items = [it for it in s["items"] if it.get("track_id") in ft]
    rest = [it for it in s["items"] if it.get("track_id") not in ft]
    tl = [{"camelot": ft[it["track_id"]]["camelot"], "bpm": ft[it["track_id"]]["bpm"], "energy": ft[it["track_id"]]["energy"]} for it in items]
    order = harmonize.order(tl, body.get("mode", "fuzzy"), body.get("direction", "any"), body.get("energy_flow", "smooth"),
                            bool(body.get("pin_first")), bool(body.get("pin_last")))
    s["items"] = [items[i] for i in order] + rest
    s["transitions"] = []
    db.save_set(s, sid)
    return s


@app.post("/api/sets/{sid}/preview/{idx}")
def preview(sid: int, idx: int):
    s = db.get_set(sid)
    pl = mixer.plan(s, _full_tracks(s))
    if idx >= len(pl["transitions"]):
        raise HTTPException(400)
    out = data_dir() / "previews"
    out.mkdir(exist_ok=True)
    for f in out.glob("*.wav"):
        if time.time() - f.stat().st_mtime > 600:
            f.unlink(missing_ok=True)
    fn = f"prev_{sid}_{idx}_{uuid.uuid4().hex[:6]}.wav"
    mixer.render_transition_preview(pl, idx, str(out / fn), sfx_dir=settings.get("sfx_dir") or None)
    return {"url": f"/api/preview_file/{fn}"}


@app.get("/api/preview_file/{fn}")
def preview_file(fn: str):
    p = data_dir() / "previews" / Path(fn).name
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


@app.post("/api/sets/{sid}/render")
def render(sid: int, body: dict = Body(...)):
    s = db.get_set(sid)
    fmt = body.get("format", "mp3")
    out = os.path.join(settings["export_dir"], safe_name(s["name"]) + "." + fmt)

    def fn(prog):
        pl = mixer.plan(s, _full_tracks(s))
        mixer.render(pl, out, sfx_dir=settings.get("sfx_dir") or None, progress=prog)
        return {"path": out}
    return {"job": run_job("render", fn)}


@app.post("/api/sets/{sid}/export/daw")
def export_daw(sid: int):
    s = db.get_set(sid)
    folder = os.path.join(settings["export_dir"], safe_name(s["name"]) + " - DAW")

    def fn(prog):
        pl = mixer.plan(s, _full_tracks(s))
        files = mixer.export_daw(pl, folder, progress=prog)
        return {"path": folder, "files": files}
    return {"job": run_job("daw", fn)}


@app.post("/api/sets/{sid}/export/rekordbox")
def export_rb(sid: int):
    s = db.get_set(sid)
    ts = []
    for it in s["items"]:
        t = db.track(it["track_id"]) if it.get("track_id") else None
        if t and t.get("analysis"):
            t["analysis"].pop("waveform", None)
            ts.append(t)
    if not ts:
        raise HTTPException(400, "Set nema analiziranih pesama")
    xml = export_rekordbox.build(s["name"], ts)
    path = os.path.join(settings["export_dir"], "SubSet_rekordbox.xml")  # one stable file for rekordbox prefs
    named = os.path.join(settings["export_dir"], safe_name(s["name"]) + ".xml")
    for p in (path, named):
        with open(p, "wb") as f:
            f.write(xml)
    m3u = os.path.join(settings["export_dir"], safe_name(s["name"]) + ".m3u8")
    with open(m3u, "w", encoding="utf-8") as f:
        f.write(export_rekordbox.build_m3u8(ts))
    return {"path": path, "copy": named, "m3u8": m3u, "folder": settings["export_dir"]}


@app.get("/api/output")
def output_file(path: str):
    rp = os.path.realpath(path)
    if not rp.startswith(os.path.realpath(settings["export_dir"])) or not os.path.exists(rp):
        raise HTTPException(404)
    return FileResponse(rp)


@app.get("/api/jobs/{jid}")
def job(jid: str):
    if jid not in jobs:
        raise HTTPException(404)
    return jobs[jid]


@app.post("/api/open")
def open_path(body: dict = Body(...)):
    p = body.get("path")
    if p and os.path.exists(p):
        if os.name == "nt":
            os.startfile(p)  # type: ignore[attr-defined]
        else:
            import subprocess
            subprocess.Popen(["xdg-open" if os.uname().sysname != "Darwin" else "open", p])
    return {"ok": True}


@app.get("/api/meta")
def meta():
    return {"transition_types": mixer.TRANSITION_TYPES, "defaults": mixer.DEFAULT_SETTINGS,
            "templates": {k: v["name"] for k, v in cues_mod.TEMPLATES.items()}}


@app.get("/")
def index():
    return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-store"})


app.mount("/web", StaticFiles(directory=str(WEB)), name="web")
