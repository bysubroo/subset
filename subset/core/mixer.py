"""Mix planning (in/out points, transitions, tempo) and offline rendering."""
from __future__ import annotations

import math
import numpy as np

from . import audio
from .harmonize import tempo_ratio, key_match_level

SR = 44100
SYNC_LIMIT = 0.08  # max +-8% stretch for beat-synced transitions
RAMP_BARS = 8      # bars to glide back to native tempo after a synced transition

TRANSITION_TYPES = {
    "bass": "Bass swap",
    "blend": "Blend (crossfade)",
    "cut": "Cut",
    "echo": "Echo out",
}

DEFAULT_SETTINGS = {
    "intro_mode": "short",   # full | short | skip
    "outro_mode": "short",   # full | short | skip
    "trans_bars": "auto",    # auto | 1 | 2 | 4 | 8 | 16 | 32 | 64
    "trans_type": "bass",
    "short_bars": 8,         # how many bars of intro/outro stay in 'short' mode
}


# ------------------------------------------------------------------ helpers

def _bar(a: dict) -> float:
    return 4 * 60.0 / a["bpm"]


def _downbeats(a: dict) -> list[float]:
    return a["grid"].get("downbeats") or [0.0]


def _snap_bar(a: dict, t: float) -> float:
    dbs = _downbeats(a)
    i = int(np.argmin([abs(d - t) for d in dbs]))
    return max(0.0, dbs[i])


def _phrase(a: dict, label: str, last: bool = False):
    ps = [p for p in a.get("phrases", []) if p["label"] == label]
    return (ps[-1] if last else ps[0]) if ps else None


def in_point(a: dict, mode: str, short_bars: int) -> float:
    dbs = _downbeats(a)
    first = max(0.0, dbs[0])
    intro = _phrase(a, "intro")
    if mode == "full" or not intro:
        return first
    body = intro["start"] + intro["bars"] * _bar(a)
    if mode == "skip":
        return _snap_bar(a, body)
    return _snap_bar(a, max(first, body - short_bars * _bar(a)))


def outro_start(a: dict) -> float:
    o = _phrase(a, "outro", last=True)
    if o:
        return o["start"]
    dbs = _downbeats(a)
    return dbs[max(0, len(dbs) - 17)]


def out_point(a: dict, mode: str, L: int, short_bars: int) -> float:
    """Source time where the outgoing transition starts."""
    o = _phrase(a, "outro", last=True)
    os_ = outro_start(a)
    bar = _bar(a)
    if mode == "skip":
        t = os_ - L * bar
    elif mode == "short":
        t = os_ + max(0, short_bars - L) * bar
    else:
        obars = o["bars"] if o else 16
        t = os_ + max(0, obars - L) * bar
    # never run past the end of the file
    t = min(t, a["duration"] - L * bar - 0.05)
    return _snap_bar(a, t)


def auto_bars(a: dict, b: dict, settings: dict) -> int:
    if settings["trans_bars"] != "auto":
        return int(settings["trans_bars"])
    o = _phrase(a, "outro", last=True)
    i = _phrase(b, "intro")
    cand = [16]
    if o:
        cand.append(o["bars"])
    if i and settings["intro_mode"] == "full":
        cand.append(i["bars"])
    if settings["outro_mode"] == "short" or settings["intro_mode"] == "short":
        cand.append(settings["short_bars"])
    L = max(2, min(cand))
    return 2 ** int(math.log2(L))


# ------------------------------------------------------------------ plan

def plan(set_data: dict, tracks: dict[int, dict]) -> dict:
    """tracks: id -> {path, analysis, artist, title}. Returns timeline plan used by UI + renderer."""
    st = {**DEFAULT_SETTINGS, **(set_data.get("settings") or {})}
    items = [it for it in set_data["items"] if it.get("track_id") in tracks]
    trans_cfg = set_data.get("transitions") or []
    entries, transitions = [], []
    t_cursor = 0.0
    prev = None
    for i, it in enumerate(items):
        tr = tracks[it["track_id"]]
        a = tr["analysis"]
        bar = _bar(a)
        e = {"idx": i, "track_id": it["track_id"], "path": tr["path"], "title": tr.get("title"), "artist": tr.get("artist"),
             "bpm": a["bpm"], "camelot": a.get("camelot"), "key": a.get("key"), "energy": a.get("energy"),
             "duration": a["duration"], "note": it.get("note", "")}
        ov = it.get("override") or {}
        e["in_src"] = ov.get("in_src", in_point(a, st["intro_mode"], st["short_bars"]))
        e["speed_pts"] = [(e["in_src"], 1.0)]
        if prev is not None:
            pa = tracks[prev["track_id"]]["analysis"]
            cfg = trans_cfg[i - 1] if i - 1 < len(trans_cfg) and trans_cfg[i - 1] else {}
            ttype = cfg.get("type") or st["trans_type"]
            L = int(cfg.get("bars") or auto_bars(pa, a, st))
            r = tempo_ratio(pa["bpm"], a["bpm"])
            synced = abs(r - 1) <= SYNC_LIMIT
            warn = None
            if not synced and ttype in ("bass", "blend"):
                ttype, warn = "echo", f"Razlika u tempu {abs(r - 1) * 100:.0f}% - prebaceno na Echo out"
            if ttype in ("cut", "echo"):
                L_eff = 0
            else:
                L_eff = L
            # outgoing track A: end of its audio
            prev_ov = (items[i - 1].get("override") or {}).get("out_src")
            a_out = prev_ov if prev_ov is not None else out_point(pa, st["outro_mode"], L_eff, st["short_bars"])
            prev["out_src"] = a_out
            a_bar = _bar(pa)
            s_a = _speed_at(prev["speed_pts"], a_out)
            prev["end_src"] = min(pa["duration"], a_out + (L_eff * a_bar if L_eff else (a_bar if ttype == "echo" else 0.0)))
            t_start = _src_to_time(prev, a_out)
            # incoming speed so its beats match A's actual tempo at the out point
            sb = (s_a * r) if synced and ttype in ("bass", "blend") else 1.0
            if sb != 1.0:
                ramp_start = e["in_src"] + L_eff * bar
                e["speed_pts"] = [(e["in_src"], sb), (ramp_start, sb), (ramp_start + RAMP_BARS * bar, 1.0)]
            e["t_start"] = t_start
            dur_sec = L_eff * a_bar / s_a if L_eff else 0.0
            transitions.append({
                "idx": i - 1, "type": ttype, "bars": L, "eff_bars": L_eff, "t_start": round(t_start, 3),
                "t_end": round(t_start + dur_sec, 3), "ratio": round(sb, 4), "synced": synced and L_eff > 0,
                "key_match": key_match_level(pa.get("camelot"), a.get("camelot")),
                "bpm_diff_pct": round(abs(r - 1) * 100, 1), "warn": warn, "sfx": cfg.get("sfx"),
            })
        else:
            e["t_start"] = 0.0
        e["out_src"] = None
        e["end_src"] = a["duration"]
        entries.append(e)
        prev = e
    # last track plays to its end (or outro end)
    for e in entries:
        e["t_end"] = _src_to_time(e, e["end_src"])
        e["out_time"] = _src_to_time(e, e["out_src"]) if e["out_src"] is not None else None
        e["speed_pts"] = [(round(s, 4), round(v, 5)) for s, v in e["speed_pts"]]
        e["in_src"] = round(e["in_src"], 4)
    total = max((e["t_end"] for e in entries), default=0.0)
    return {"settings": st, "entries": entries, "transitions": transitions, "total": round(total, 3)}


def _speed_at(pts, src):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return float(np.interp(src, xs, ys))


def _src_to_time(e: dict, src: float | None) -> float:
    if src is None:
        return None
    a, b = e["in_src"], src
    if b <= a:
        return e["t_start"]
    n = max(2, int((b - a) * 50))
    xs = np.linspace(a, b, n)
    sp = np.array([_speed_at(e["speed_pts"], x) for x in xs])
    return float(e["t_start"] + np.trapezoid(1.0 / sp, xs))


# ------------------------------------------------------------------ render

def _lr_split(x: np.ndarray, fc: float = 160.0):
    from scipy.signal import butter, sosfilt
    lo = butter(2, fc, "low", fs=SR, output="sos")
    hi = butter(2, fc, "high", fs=SR, output="sos")
    low = sosfilt(lo, sosfilt(lo, x, axis=0), axis=0)
    high = sosfilt(hi, sosfilt(hi, x, axis=0), axis=0)
    return low.astype(np.float32), high.astype(np.float32)


def _render_track(e: dict) -> np.ndarray:
    y, _ = audio.load(e["path"], SR)
    a, b = int(e["in_src"] * SR), int(e["end_src"] * SR)
    x = np.ascontiguousarray(y[max(0, a):b])
    pts = e["speed_pts"]
    if all(abs(v - 1.0) < 1e-6 for _, v in pts):
        return x
    import pedalboard
    src_t = e["in_src"] + np.arange(len(x)) / SR
    sp = np.interp(src_t, [p[0] for p in pts], [p[1] for p in pts]).astype(np.float64)
    out = pedalboard.time_stretch(x.T.copy(), SR, stretch_factor=sp, high_quality=True,
                                  transient_mode="crisp")
    return out.T.astype(np.float32)


def _ramp(n, kind="lin"):
    x = np.linspace(0, 1, max(n, 1), dtype=np.float32)
    if kind == "cos_out":
        return np.cos(x * np.pi / 2)
    if kind == "sin_in":
        return np.sin(x * np.pi / 2)
    return x


def render(pl: dict, out_path: str, sfx_dir: str | None = None, window: tuple[float, float] | None = None,
           progress=None, raw: bool = False) -> str:
    entries, trans = pl["entries"], pl["transitions"]
    total = pl["total"] + 3.0
    w0, w1 = window if window else (0.0, total)
    N = int((w1 - w0) * SR) + 1
    mix = np.zeros((N, 2), np.float32)
    for k, e in enumerate(entries):
        if e["t_end"] < w0 or e["t_start"] > w1:
            continue
        if progress:
            progress(k, len(entries), e.get("title"))
        x = _render_track(e)
        n = len(x)
        g_low = np.ones(n, np.float32)
        g_high = np.ones(n, np.float32)
        tin = trans[k - 1] if k > 0 else None
        tout = trans[k] if k < len(trans) else None
        # incoming transition (this track = B)
        if tin:
            Ln = int((tin["t_end"] - tin["t_start"]) * SR)
            if tin["type"] == "blend" and Ln > 0:
                g = _ramp(Ln, "sin_in"); g_low[:Ln] *= g; g_high[:Ln] *= g
            elif tin["type"] == "bass" and Ln > 0:
                g_high[:Ln] *= _ramp(Ln, "sin_in")
                g_low[: Ln // 2] = 0.0
                f = min(441, Ln // 2)
                g_low[Ln // 2: Ln // 2 + f] *= _ramp(f)
            else:  # cut / echo: tiny fade-in to avoid clicks
                f = int(0.004 * SR); g_low[:f] *= _ramp(f); g_high[:f] *= _ramp(f)
        # outgoing transition (this track = A)
        if tout:
            s0 = int((tout["t_start"] - e["t_start"]) * SR)
            Ln = int((tout["t_end"] - tout["t_start"]) * SR)
            if tout["type"] == "blend" and Ln > 0:
                g = _ramp(Ln, "cos_out"); g_low[s0:s0 + Ln] *= g[: max(0, n - s0)]; g_high[s0:s0 + Ln] *= g[: max(0, n - s0)]
                g_low[s0 + Ln:] = 0; g_high[s0 + Ln:] = 0
            elif tout["type"] == "bass" and Ln > 0:
                g = _ramp(Ln, "cos_out")
                g_high[s0:s0 + Ln] *= g[: max(0, n - s0)]
                m = s0 + Ln // 2
                f = min(441, Ln // 2)
                g_low[m:m + f] *= _ramp(f)[::-1][: max(0, n - m)]
                g_low[m + f:] = 0; g_high[s0 + Ln:] = 0
            elif tout["type"] == "cut":
                f = int(0.012 * SR)
                g_low[s0:s0 + f] *= _ramp(f)[::-1][: max(0, n - s0)]; g_high[s0:s0 + f] *= _ramp(f)[::-1][: max(0, n - s0)]
                g_low[s0 + f:] = 0; g_high[s0 + f:] = 0
        if tin and tin["type"] == "bass" or tout and tout["type"] == "bass":
            lo, hi = _lr_split(x)
            y = lo * g_low[:, None] + hi * g_high[:, None]
        else:
            y = x * g_low[:, None]
        if tout and tout["type"] == "echo":
            s0 = int((tout["t_start"] - e["t_start"]) * SR)
            y = _echo_out(y, s0, 60.0 / (e["bpm"] * (e["speed_pts"][-1][1] if e["speed_pts"] else 1)))
        # place on timeline
        off = int((e["t_start"] - w0) * SR)
        a0 = max(0, -off)
        b0 = min(len(y), N - off)
        if b0 > a0:
            mix[off + a0: off + b0] += y[a0:b0]
    # SFX at transition points
    if sfx_dir:
        import os
        for tr in trans:
            if tr.get("sfx"):
                p = os.path.join(sfx_dir, tr["sfx"])
                if os.path.exists(p):
                    s, _ = audio.load(p, SR)
                    off = int((tr["t_start"] - w0) * SR)
                    if 0 <= off < N:
                        m = min(len(s), N - off)
                        mix[off:off + m] += 0.7 * s[:m]
    if raw:  # DAW stems: 24-bit FLAC (leading silence compresses to almost nothing)
        import soundfile as sf
        sf.write(out_path, np.clip(mix, -1, 1), SR, format="FLAC", subtype="PCM_24")
        return out_path
    return _finish(mix, out_path)


def _echo_out(y: np.ndarray, s0: int, beat: float) -> np.ndarray:
    import pedalboard
    bar = int(4 * beat * SR)
    tail = int(3 * 4 * beat * SR)
    seg = y[s0:s0 + bar].copy()
    seg *= np.linspace(1, 0.6, len(seg), dtype=np.float32)[:, None]
    seg = np.concatenate([seg, np.zeros((tail, 2), np.float32)])
    fx = pedalboard.Pedalboard([pedalboard.Delay(delay_seconds=beat * 0.75, feedback=0.55, mix=0.5),
                                pedalboard.HighpassFilter(250)])
    wet = fx(seg.T.copy(), SR).T
    out = np.zeros((s0 + len(wet), 2), np.float32)
    out[:s0] = y[:s0]
    out[s0:] = wet
    return out


def _finish(mix: np.ndarray, out_path: str) -> str:
    import pedalboard
    board = pedalboard.Pedalboard([pedalboard.Limiter(threshold_db=-1.0, release_ms=120)])
    y = board(mix.T.copy(), SR).T
    peak = np.abs(y).max()
    if peak > 0.98:
        y = y / peak * 0.98
    if out_path.lower().endswith(".mp3"):
        import lameenc
        enc = lameenc.Encoder()
        enc.set_bit_rate(320); enc.set_in_sample_rate(SR); enc.set_channels(2); enc.set_quality(2)
        pcm = (np.clip(y, -1, 1) * 32767).astype("<i2").tobytes()
        with open(out_path, "wb") as f:
            f.write(enc.encode(pcm)); f.write(enc.flush())
    else:
        import soundfile as sf
        sf.write(out_path, y, SR, subtype="PCM_24")
    return out_path


def export_daw(pl: dict, folder: str, progress=None) -> list[str]:
    """One full-length WAV per track (all start at 0:00, transitions/tempo baked in) + MIDI marker file.
    Drag all files into FL Studio / Cubase at bar 1 and they line up exactly."""
    import os
    import re
    os.makedirs(folder, exist_ok=True)
    files = []
    for k, e in enumerate(pl["entries"]):
        keep = [x if x["idx"] == e["idx"] else {**x, "t_start": 1e9, "t_end": 1e9} for x in pl["entries"]]
        name = re.sub(r'[\\/:*?"<>|]', "_", f"{k + 1:02d} - {e.get('artist') or ''} - {e.get('title') or ''}")
        p = os.path.join(folder, name + ".flac")
        if progress:
            progress(k, len(pl["entries"]), e.get("title"))
        render({**pl, "entries": keep}, p, raw=True)
        files.append(p)
    mid = os.path.join(folder, "SubSet markeri.mid")
    _write_marker_midi(mid, [(e["t_start"], f"{k + 1:02d} {e.get('title') or ''}") for k, e in enumerate(pl["entries"])] +
                       [(t["t_start"], f"T{t['idx'] + 1} {t['type']}") for t in pl["transitions"]])
    files.append(mid)
    return files


def _write_marker_midi(path: str, markers: list[tuple[float, str]], bpm: float = 120.0):
    """Minimal type-0 MIDI file with tempo + marker meta events (seconds -> ticks at 120 BPM)."""
    tpq = 960
    sec_per_tick = 60.0 / bpm / tpq

    def vlq(n):
        out = [n & 0x7F]
        n >>= 7
        while n:
            out.insert(0, (n & 0x7F) | 0x80)
            n >>= 7
        return bytes(out)

    ev = bytearray()
    ev += vlq(0) + b"\xff\x51\x03" + int(60_000_000 / bpm).to_bytes(3, "big")
    last = 0
    for t, name in sorted(markers):
        tick = int(round(t / sec_per_tick))
        data = name.encode("utf-8")[:120]
        ev += vlq(max(0, tick - last)) + b"\xff\x06" + vlq(len(data)) + data
        last = tick
    ev += vlq(0) + b"\xff\x2f\x00"
    with open(path, "wb") as f:
        f.write(b"MThd" + (6).to_bytes(4, "big") + (0).to_bytes(2, "big") + (1).to_bytes(2, "big") + tpq.to_bytes(2, "big"))
        f.write(b"MTrk" + len(ev).to_bytes(4, "big") + bytes(ev))


def render_transition_preview(pl: dict, idx: int, out_path: str, pre_bars: int = 16, post_bars: int = 16,
                              sfx_dir: str | None = None) -> str:
    tr = pl["transitions"][idx]
    a = pl["entries"][idx]
    bar = 4 * 60.0 / a["bpm"]
    w0 = max(0.0, tr["t_start"] - pre_bars * bar)
    w1 = tr["t_end"] + post_bars * bar
    sub = {"entries": pl["entries"], "transitions": pl["transitions"], "total": pl["total"]}
    # only render the two tracks involved
    keep = {idx, idx + 1}
    ents = [e if e["idx"] in keep else {**e, "t_start": 1e9, "t_end": 1e9} for e in sub["entries"]]
    return render({**sub, "entries": ents}, out_path, sfx_dir=sfx_dir, window=(w0, w1))
