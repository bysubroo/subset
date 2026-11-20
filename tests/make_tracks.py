"""Generate synthetic structured test tracks (intro/build/drop/break/drop/outro)."""
import sys
import numpy as np
import soundfile as sf

SR = 44100
NOTE = {"C": 0, "C#": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def make(path, bpm, root, minor=True, seed=0, lead_in=0.0):
    rng = np.random.default_rng(seed)
    beat = 60 / bpm
    bar = 4 * beat
    plan = [("intro", 16, dict(kick=1, hat=1)), ("build", 8, dict(kick=1, hat=1, chords=0.5, riser=1)),
            ("drop", 32, dict(kick=1, hat=1, bass=1, chords=1)), ("break", 16, dict(chords=1)),
            ("drop", 16, dict(kick=1, hat=1, bass=1, chords=1)), ("outro", 16, dict(kick=1, hat=1))]
    total = int((lead_in + sum(p[1] for p in plan) * bar + 1) * SR)
    y = np.zeros(total, np.float32)
    t_kick = np.arange(int(0.25 * SR)) / SR
    kick = np.sin(2 * np.pi * (50 + 120 * np.exp(-t_kick * 30)) * t_kick) * np.exp(-t_kick * 9)
    hat = rng.normal(0, 1, int(0.05 * SR)) * np.exp(-np.arange(int(0.05 * SR)) / SR * 80)
    hat = np.diff(hat, prepend=0) * 0.3
    third = 3 if minor else 4
    prog = [0, 8, 3, 10] if minor else [0, 7, 9, 5]
    base = 57 + NOTE[root] - 9  # around A3
    t = lead_in
    for name, nbars, parts in plan:
        for b in range(nbars):
            s = int(t * SR)
            chord_root = base + prog[b % 4] if minor else base + prog[b % 4]
            for k in range(4):
                bs = int((t + k * beat) * SR)
                if parts.get("kick"):
                    y[bs:bs + len(kick)] += 0.9 * kick[: len(y) - bs]
                if parts.get("hat"):
                    hs = int((t + k * beat + beat / 2) * SR)
                    y[hs:hs + len(hat)] += hat[: len(y) - hs]
            n = int(bar * SR)
            tt = np.arange(n) / SR
            if parts.get("chords"):
                deg = prog[b % 4]
                r = base + deg
                tri = [r, r + (3 if (minor and deg in (0, 3)) or (not minor and deg in (9,)) else 4), r + 7]
                tri = [r, r + third, r + 7] if deg == 0 else tri
                c = sum(np.sin(2 * np.pi * hz(m) * tt) for m in tri) / 3
                y[s:s + n] += 0.18 * parts["chords"] * c[: len(y) - s]
            if parts.get("bass"):
                r = base + prog[b % 4] - 24
                for k in range(8):
                    bs = s + int(k * beat / 2 * SR)
                    nn = int(beat / 2 * SR)
                    tb = np.arange(nn) / SR
                    y[bs:bs + nn] += 0.35 * np.sin(2 * np.pi * hz(r) * tb)[: len(y) - bs] * np.exp(-tb * 4)
            if parts.get("riser"):
                f = 200 + 1800 * (b + tt / bar) / nbars
                y[s:s + n] += 0.05 * (b + 1) / nbars * rng.normal(0, 1, n)[: len(y) - s]
            t += bar
    y = y / (np.abs(y).max() + 1e-9) * 0.9
    sf.write(path, np.stack([y, y], 1), SR)


if __name__ == "__main__":
    out = sys.argv[1]
    import os
    os.makedirs(out, exist_ok=True)
    make(f"{out}/Artist One - Night Drive.wav", 126, "A", True, 1, lead_in=0.3)
    make(f"{out}/Artist Two - Sunrise.wav", 124, "E", True, 2)
    make(f"{out}/Artist Three - Gold.wav", 128, "C", False, 3, lead_in=0.15)
    make(f"{out}/Artist Two - Sunrise (Club Remix).wav", 127, "E", True, 4)
    print("ok")
