"""Audio loading helpers. soundfile first (wav/flac/aiff/mp3), pedalboard as fallback (m4a/aac on Windows/Mac)."""
from __future__ import annotations

import numpy as np

try:
    import soundfile as sf
except Exception:  # pragma: no cover
    sf = None

try:
    from pedalboard.io import AudioFile
except Exception:  # pragma: no cover
    AudioFile = None


def _resample(y: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return y
    import soxr
    return soxr.resample(y, sr_in, sr_out, quality="HQ")


def load(path: str, sr: int = 44100, mono: bool = False) -> tuple[np.ndarray, int]:
    """Return float32 audio shaped (frames, channels) (or (frames,) if mono) at `sr`."""
    data = None
    file_sr = None
    if sf is not None:
        try:
            data, file_sr = sf.read(path, dtype="float32", always_2d=True)
        except Exception:
            data = None
    if data is None:
        if AudioFile is None:
            raise RuntimeError(f"Ne mogu da otvorim fajl: {path}")
        with AudioFile(path) as f:
            file_sr = int(f.samplerate)
            data = f.read(f.frames).T.astype(np.float32)  # (frames, ch)
    if data.shape[1] == 1 and not mono:
        data = np.repeat(data, 2, axis=1)
    if data.shape[1] > 2:
        data = data[:, :2]
    if mono:
        data = data.mean(axis=1)
    data = _resample(data, int(file_sr), sr).astype(np.float32)
    return data, sr


def duration(path: str) -> float:
    if sf is not None:
        try:
            info = sf.info(path)
            return float(info.frames) / float(info.samplerate)
        except Exception:
            pass
    if AudioFile is not None:
        with AudioFile(path) as f:
            return float(f.frames) / float(f.samplerate)
    return 0.0


AUDIO_EXT = {".wav", ".aif", ".aiff", ".flac", ".mp3", ".m4a", ".aac", ".ogg"}
