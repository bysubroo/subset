"""Track analysis: beatgrid, key, energy, phrases, 3-band waveform.

Beat/downbeat tracking uses the Beat This! model (CPJKU, 2024) when installed
(GPU if available); otherwise a librosa fallback so the app always works.
"""
from __future__ import annotations

import logging
import numpy as np
import librosa

from . import audio

log = logging.getLogger("subset.analysis")

SR = 22050
HOP = 512

# ---------------------------------------------------------------- beats

_beat_model = None
_beat_model_failed = False


def _get_beat_model():
    global _beat_model, _beat_model_failed
    if _beat_model is not None or _beat_model_failed:
        return _beat_model
    try:
        import torch
        from beat_this.inference import Audio2Beats
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _beat_model = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)
        log.info("Beat This! model ucitan (%s)", device)
    except Exception as e:  # model not installed / no network on first run
        log.warning("Beat This! nije dostupan, koristim rezervni beat tracker: %s", e)
        _beat_model_failed = True
    return _beat_model


def engine_status() -> str | None:
    if _beat_model is not None:
        return "Beat This! (AI)"
    return "librosa (rezervni)" if _beat_model_failed else None


def beat_engine_name() -> str:
    return "Beat This! (AI)" if _get_beat_model() is not None else "librosa (rezervni)"


def _track_beats(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    model = _get_beat_model()
    if model is not None:
        beats, downbeats = model(y, sr)
        return np.asarray(beats, float), np.asarray(downbeats, float)
    return _fallback_beats(y, sr)


def _fallback_beats(y: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """Constant-tempo grid estimator (precise period via long-lag autocorrelation + phase folding)."""
    hop = 128
    fps = sr / hop
    S = np.abs(librosa.stft(y, n_fft=1024, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=1024)
    logS = np.log1p(100 * S)
    flux = np.maximum(0, np.diff(logS, axis=1, prepend=logS[:, :1]))
    onset = flux.sum(0)
    low_on = flux[freqs < 150].sum(0)
    onset = onset - np.convolve(onset, np.ones(64) / 64, mode="same")
    onset = np.maximum(onset, 0)
    n = len(onset)
    f = np.fft.rfft(onset, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    ac /= ac[0] + 1e-9

    def acv(lag):
        i = int(lag)
        if i + 1 >= n:
            return 0.0
        fr = lag - i
        return ac[i] * (1 - fr) + ac[i + 1] * fr

    def score(T, N=32):
        return sum(acv(k * T * fps) for k in range(1, N + 1)) / N

    cands = np.arange(70.0, 180.0, 0.25)
    sc = np.array([score(60 / b, 8) for b in cands])
    prior = np.exp(-0.5 * (np.log2(cands / 120.0) / 0.9) ** 2)
    b0 = cands[int(np.argmax(sc * (0.6 + 0.4 * prior)))]
    fine = np.arange(b0 - 0.5, b0 + 0.5, 0.005)
    N = int(min(256, max(16, (n / fps) / (60 / b0) * 0.5)))
    bpm = fine[int(np.argmax([score(60 / b, N) for b in fine]))]
    T = 60.0 / bpm
    # phase: fold onset envelope modulo T
    t = np.arange(n) / fps
    bins = 200
    ph = np.floor((t % T) / T * bins).astype(int)
    low_n = low_on / (low_on.max() + 1e-9)
    on_n = onset / (onset.max() + 1e-9)
    hist = np.bincount(ph, weights=2.0 * low_n + on_n, minlength=bins)  # kicks define the beat
    hist = np.convolve(np.r_[hist, hist[:4]], np.ones(5) / 5, mode="valid")[:bins]
    t0 = (np.argmax(hist) + 2) / bins * T % T
    beats = np.arange(t0, n / fps, T)
    # downbeat phase: sections and chords change on downbeats -> look for energy/chroma jumps
    fr = np.minimum((beats * fps).astype(int), n - 1)
    energy_b = np.array([logS[:, a:b].mean() if b > a else 0 for a, b in zip(fr[:-1], fr[1:])])
    chroma = librosa.feature.chroma_stft(S=S ** 2, sr=sr)
    chroma_b = np.array([chroma[:, a:b].mean(1) if b > a else np.zeros(12) for a, b in zip(fr[:-1], fr[1:])])
    jump = np.r_[0, np.abs(np.diff(energy_b))]
    cjump = np.r_[0, np.linalg.norm(np.diff(chroma_b, axis=0), axis=1)]
    jump = jump / (jump.max() + 1e-9) + cjump / (cjump.max() + 1e-9)
    lowb = low_on[fr[:-1]] / (low_on.max() + 1e-9)
    scores = [jump[p::4].sum() + 0.3 * lowb[p::4].mean() for p in range(4)]
    p = int(np.argmax(scores))
    return beats, beats[p::4]


def _fit_grid(beats: np.ndarray, downbeats: np.ndarray, dur: float) -> dict:
    """Fit a constant grid if the track is steady, otherwise keep a dynamic grid."""
    if len(beats) < 8:
        bpm = 120.0
        return {"type": "constant", "bpm": bpm, "first_downbeat": 0.0, "beats": [], "downbeats": []}
    ibi = np.diff(beats)
    med = np.median(ibi)
    good = np.abs(ibi - med) < 0.25 * med
    # robust linear fit beat_index -> time
    idx = np.concatenate([[0], np.cumsum(np.round(ibi / med))]).astype(float)
    mask = np.concatenate([[True], good])
    for _ in range(3):
        A = np.vstack([idx[mask], np.ones(mask.sum())]).T
        (T, t0), *_ = np.linalg.lstsq(A, beats[mask], rcond=None)
        resid = beats - (idx * T + t0)
        mask = np.abs(resid) < 0.03
        if mask.sum() < 8:
            mask = np.abs(resid) < 0.06
    bpm = 60.0 / T
    # tidy bpm: snap near-integers
    if abs(bpm - round(bpm)) < 0.04:
        bpm = float(round(bpm))
        T = 60.0 / bpm
        # refit offset with fixed T
        t0 = float(np.median(beats[mask] - idx[mask] * T))
    steady = np.mean(np.abs(beats - (idx * T + t0)) < 0.035) > 0.85
    # downbeat phase
    if len(downbeats):
        k = np.round((downbeats - t0) / T).astype(int)
        phase = int(np.bincount(np.mod(k, 4), minlength=4).argmax())
    else:
        phase = 0
    first = t0 + phase * T
    while first - 4 * T >= -0.02:
        first -= 4 * T
    while first < -0.02:
        first += 4 * T
    grid = {
        "type": "constant" if steady else "dynamic",
        "bpm": round(float(bpm), 2),
        "first_downbeat": round(float(first), 4),
    }
    if steady:
        n = int((dur - first) / T) + 1
        grid_beats = first + np.arange(n) * T
    else:
        grid_beats = beats
        grid["bpm"] = round(float(60.0 / med), 2)
    grid["beats"] = [round(float(b), 4) for b in grid_beats]
    # downbeats every 4 beats from the first downbeat
    start = int(np.argmin(np.abs(grid_beats - first)))
    grid["downbeats"] = [round(float(b), 4) for b in grid_beats[start::4]]
    return grid


# ---------------------------------------------------------------- key

# KeyFinder-style profiles (well suited to electronic music)
_MAJ = np.array([7.24, 3.50, 3.58, 2.85, 5.82, 4.56, 2.45, 7.00, 3.39, 4.56, 4.07, 4.46])
_MIN = np.array([7.01, 3.14, 4.36, 5.40, 3.68, 4.10, 3.15, 6.53, 4.09, 3.76, 4.02, 3.88])
NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
CAMELOT_MAJ = {0: "8B", 7: "9B", 2: "10B", 9: "11B", 4: "12B", 11: "1B", 6: "2B", 1: "3B", 8: "4B", 3: "5B", 10: "6B", 5: "7B"}
CAMELOT_MIN = {9: "8A", 4: "9A", 11: "10A", 6: "11A", 1: "12A", 8: "1A", 3: "2A", 10: "3A", 5: "4A", 0: "5A", 7: "6A", 2: "7A"}


def _key(y: np.ndarray, sr: int) -> dict:
    yh = librosa.effects.harmonic(y, margin=2.0)
    chroma = librosa.feature.chroma_cqt(y=yh, sr=sr, hop_length=HOP * 4, bins_per_octave=36)
    w = librosa.feature.rms(y=yh, hop_length=HOP * 4)[0]
    n = min(chroma.shape[1], len(w))
    prof = (chroma[:, :n] * w[:n]).sum(axis=1)
    prof = prof / (prof.sum() + 1e-9)
    best = (-2, 0, "maj")
    for tonic in range(12):
        for mode, p in (("maj", _MAJ), ("min", _MIN)):
            r = np.corrcoef(prof, np.roll(p, tonic))[0, 1]
            if r > best[0]:
                best = (r, tonic, mode)
    r, tonic, mode = best
    name = NOTES[tonic] + ("m" if mode == "min" else "")
    cam = (CAMELOT_MIN if mode == "min" else CAMELOT_MAJ)[tonic]
    return {"key": name, "camelot": cam, "confidence": round(float(r), 3)}


# ---------------------------------------------------------------- features per bar

def _band_energies(y: np.ndarray, sr: int):
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP)) ** 2
    f = librosa.fft_frequencies(sr=sr, n_fft=2048)
    low = S[f < 200].sum(0)
    mid = S[(f >= 200) & (f < 2500)].sum(0)
    high = S[f >= 2500].sum(0)
    return low, mid, high


def _waveform(low, mid, high, points_per_sec: int = 100, sr: int = SR) -> dict:
    """3-band waveform (rekordbox style), uint8 per band, `points_per_sec` resolution."""
    fps = sr / HOP
    step = max(1, int(round(fps / points_per_sec)))
    def red(x):
        x = np.sqrt(x)
        n = len(x) // step
        x = x[: n * step].reshape(n, step).max(axis=1)
        return x
    l, m, h = red(low), red(mid), red(high)
    peak = max(l.max(), m.max(), h.max(), 1e-9)
    q = lambda a: np.clip(a / peak * 255, 0, 255).astype(np.uint8).tolist()
    return {"rate": fps / step, "low": q(l), "mid": q(m), "high": q(h)}


def _bar_features(y, sr, downbeats, low, mid, high):
    fps = sr / HOP
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=HOP)
    feats = []
    for i in range(len(downbeats) - 1):
        a, b = int(downbeats[i] * fps), int(downbeats[i + 1] * fps)
        if b <= a:
            b = a + 1
        tot = low[a:b] + mid[a:b] + high[a:b]
        feats.append([
            10 * np.log10(tot.mean() + 1e-10),
            10 * np.log10(low[a:b].mean() + 1e-10),
            10 * np.log10(high[a:b].mean() + 1e-10),
            onset[a:b].mean(),
            *chroma[:, a:b].mean(axis=1),
        ])
    return np.array(feats) if feats else np.zeros((0, 16))


# ---------------------------------------------------------------- phrases

def _phrases(F: np.ndarray, downbeats: list[float], dur: float) -> list[dict]:
    nb = len(F)
    while nb > 8 and F[nb - 1, 0] < -60:  # trailing silence
        nb -= 1
    F = F[:nb]
    if nb < 8:
        return [{"label": "intro", "start_bar": 0, "bars": max(nb, 1), "start": downbeats[0] if downbeats else 0.0}]
    # 4-bar blocks
    blk = 4
    nblk = nb // blk
    B = np.array([F[i * blk:(i + 1) * blk].mean(0) for i in range(nblk)])
    # robust scaling (median/MAD) so one huge breakdown doesn't hide smaller section changes
    mad = np.median(np.abs(B - np.median(B, 0)), 0) * 1.4826
    sc = np.maximum(mad, 0.25 * B.std(0)) + 1e-6
    Z = (B - np.median(B, 0)) / sc
    Z[:, 4:] *= 0.35  # chroma counts less than energy/brightness/onsets
    Z[:, 1] *= 1.5    # bass in/out is the strongest DJ-relevant section cue
    nov = np.zeros(nblk)
    for i in range(1, nblk):
        nov[i] = np.linalg.norm(Z[i] - Z[i - 1])
    thr = max(1.6, 4.0 * float(np.median(nov[1:])))
    bounds = [0]
    for i in range(1, nblk):
        is_peak = nov[i] >= thr and nov[i] >= nov[max(0, i - 1)] and nov[i] >= nov[min(nblk - 1, i + 1)]
        if is_peak and (i - bounds[-1]) * blk >= 8:
            bounds.append(i)
        elif is_peak and len(bounds) > 1 and nov[i] > nov[bounds[-1]] and (i - bounds[-2]) * blk >= 8:
            bounds[-1] = i  # stronger boundary nearby wins
    # prefer 8-bar aligned boundaries (snap by one block if neighbour is aligned and nearly as novel)
    snapped = [0]
    for b in bounds[1:]:
        if (b * blk) % 8 != 0:
            for c in (b - 1, b + 1):
                if 0 < c < nblk and (c * blk) % 8 == 0 and nov[c] > 0.8 * nov[b] and c > snapped[-1] + 1:
                    b = c
                    break
        if b > snapped[-1]:
            snapped.append(b)
    edges = [b * blk for b in snapped] + [nb]
    segs = []
    for s, e in zip(edges[:-1], edges[1:]):
        if e - s <= 0:
            continue
        seg = F[s:e]
        segs.append({"start_bar": s, "bars": e - s, "loud": float(seg[:, 0].mean()), "low": float(seg[:, 1].mean()),
                     "slope": float(np.polyfit(np.arange(e - s), seg[:, 0], 1)[0]) if e - s > 2 else 0.0})
    # intensity in dB relative to the loudest section (loudness + low end)
    for s in segs:
        s["I"] = s["loud"] + 0.5 * s["low"]
    imax = max(s["I"] for s in segs)
    imin = min(s["I"] for s in segs)
    for s in segs:
        s["d"] = s["I"] - imax
        s["E"] = (s["I"] - imin) / (imax - imin + 1e-6)
    low_max = max(s["low"] for s in segs)
    # labels
    for s in segs:
        if s["d"] > -1.5:
            s["label"] = "drop" if s["low"] > low_max - 3 else "chorus"
        elif s["d"] < -7.5:
            s["label"] = "break"
        else:
            s["label"] = "verse"
    for i, s in enumerate(segs):
        nxt = segs[i + 1] if i + 1 < len(segs) else None
        if nxt and nxt["label"] in ("drop", "chorus") and s["label"] == "verse" and i > 0 and s["bars"] <= 16:
            s["label"] = "build"
    if segs[0]["label"] not in ("drop", "chorus"):
        segs[0]["label"] = "intro"
    if len(segs) > 1 and segs[-1]["label"] not in ("drop", "chorus"):
        segs[-1]["label"] = "outro"
    elif len(segs) > 1 and segs[-1]["bars"] > 16:
        # no clear outro: last 16 bars become outro
        last = segs[-1]
        last["bars"] -= 16
        segs.append({**last, "start_bar": last["start_bar"] + last["bars"], "bars": 16, "label": "outro"})
    out = []
    for s in segs:
        sb = s["start_bar"]
        out.append({"label": s["label"], "start_bar": sb, "bars": s["bars"],
                    "start": float(downbeats[sb]) if sb < len(downbeats) else dur,
                    "energy": round(float(s["E"]), 3)})
    return out


# ---------------------------------------------------------------- energy (1..10)

def _energy(F: np.ndarray) -> int:
    if len(F) == 0:
        return 5
    loud = np.sort(F[:, 0])[len(F) // 2:].mean()  # loudest half
    dens = np.sort(F[:, 3])[len(F) // 2:].mean()
    lowr = np.sort(F[:, 1] - F[:, 0])[len(F) // 2:].mean()
    l = np.clip((loud + 30) / 22, 0, 1)
    d = np.clip(dens / 3.0, 0, 1)
    b = np.clip((lowr + 6) / 6, 0, 1)
    return int(np.clip(round(1 + 9 * (0.5 * l + 0.35 * d + 0.15 * b)), 1, 10))


# ---------------------------------------------------------------- main entry

def analyze(path: str) -> dict:
    y, sr = audio.load(path, sr=SR, mono=True)
    dur = len(y) / sr
    beats, downbeats = _track_beats(y, sr)
    grid = _fit_grid(beats, downbeats, dur)
    low, mid, high = _band_energies(y, sr)
    dbs = list(grid["downbeats"])
    if not dbs or dbs[-1] < dur:
        dbs.append(dur)
    F = _bar_features(y, sr, dbs, low, mid, high)
    phrases = _phrases(F, dbs, dur)
    key = _key(y, sr)
    return {
        "duration": round(dur, 3),
        "grid": grid,
        "bpm": grid["bpm"],
        **key,
        "energy": _energy(F),
        "phrases": phrases,
        "waveform": _waveform(low, mid, high),
        "beat_engine": beat_engine_name(),
        "version": 1,
    }
