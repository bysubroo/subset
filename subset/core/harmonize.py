"""Harmonize: order tracks by key (Camelot), tempo and energy.

Modes:
  fuzzy - stay on compatible keys (same, +-1, relative) -> live sets
  mood  - also allow energy-boost jumps (+2, +7) -> studio mixes
Tempo: 'any', 'asc', 'desc'. First/last track can be pinned.
"""
from __future__ import annotations

import itertools
import math


def parse_camelot(c: str | None):
    if not c:
        return None
    try:
        return int(c[:-1]), c[-1].upper()
    except Exception:
        return None


def key_cost(a: str | None, b: str | None, mode: str = "fuzzy") -> float:
    pa, pb = parse_camelot(a), parse_camelot(b)
    if not pa or not pb:
        return 2.0
    (na, la), (nb, lb) = pa, pb
    d = (nb - na) % 12
    if la == lb:
        if d == 0:
            return 0.0
        if d in (1, 11):
            return 0.5
        if mode == "mood" and d in (2, 7):  # energy boost / "Mood" jump
            return 1.0
        if d in (2, 10):
            return 2.5
        return 5.0
    # letter change
    if d == 0:
        return 0.6  # relative major/minor
    if mode == "mood" and d in (1, 11):
        return 1.5  # diagonal
    return 5.0


def key_match_level(a, b) -> str:
    c = key_cost(a, b, "mood")
    return "good" if c <= 0.6 else ("ok" if c <= 1.5 else "bad")


def tempo_ratio(bpm_a: float, bpm_b: float) -> float:
    """Ratio B must be stretched by to reach A, folding half/double time."""
    if not bpm_a or not bpm_b:
        return 1.0
    r = bpm_a / bpm_b
    for f in (2.0, 0.5):
        if abs(math.log(r * f)) < abs(math.log(r)):
            r *= f
    return r


def bpm_cost(a: float, b: float, direction: str = "any") -> float:
    if not a or not b:
        return 1.0
    pct = abs(tempo_ratio(a, b) - 1) * 100
    c = (pct / 2.0) ** 1.5  # 2% ~ 1 point, 6% ~ 5 points
    if direction == "asc" and b < a - 0.5:
        c += 3.0
    if direction == "desc" and b > a + 0.5:
        c += 3.0
    return c


def pair_cost(ta: dict, tb: dict, mode: str, direction: str, energy_flow: str) -> float:
    c = 1.4 * key_cost(ta.get("camelot"), tb.get("camelot"), mode)
    c += bpm_cost(ta.get("bpm") or 0, tb.get("bpm") or 0, direction)
    ea, eb = ta.get("energy") or 5, tb.get("energy") or 5
    if energy_flow == "build" and eb < ea:
        c += 0.4 * (ea - eb)
    elif energy_flow == "smooth":
        c += 0.25 * abs(eb - ea)
    return c


def order(tracks: list[dict], mode: str = "fuzzy", direction: str = "any", energy_flow: str = "smooth",
          pin_first: bool = False, pin_last: bool = False) -> list[int]:
    """Returns new order as indices into `tracks`."""
    n = len(tracks)
    if n <= 2:
        return list(range(n))
    C = [[pair_cost(tracks[i], tracks[j], mode, direction, energy_flow) if i != j else 0 for j in range(n)] for i in range(n)]
    if direction == "asc":
        start_bias = [0.15 * (t.get("bpm") or 0) for t in tracks]
    elif direction == "desc":
        start_bias = [-0.15 * (t.get("bpm") or 0) for t in tracks]
    else:
        start_bias = [0.0] * n

    if n <= 11:
        # Held-Karp exact DP over paths
        INF = float("inf")
        starts = [0] if pin_first else range(n)
        dp = {}
        for s in starts:
            dp[(1 << s, s)] = (start_bias[s], [s])
        full = (1 << n) - 1
        for size in range(2, n + 1):
            nd = {}
            for (mask, last), (cost, path) in dp.items():
                for j in range(n):
                    if mask & (1 << j):
                        continue
                    if pin_last and j == n - 1 and size != n:
                        continue
                    nm = mask | (1 << j)
                    nc = cost + C[last][j]
                    if nc < nd.get((nm, j), (INF,))[0]:
                        nd[(nm, j)] = (nc, path + [j])
            dp = nd
        best = min((v for (m, _), v in dp.items() if m == full), key=lambda v: v[0])
        return best[1]

    # greedy from every allowed start + 2-opt
    def path_cost(p):
        return start_bias[p[0]] + sum(C[a][b] for a, b in zip(p, p[1:]))

    best = None
    for s in ([0] if pin_first else range(n)):
        p = [s]
        rest = set(range(n)) - {s} - ({n - 1} if pin_last else set())
        while rest:
            j = min(rest, key=lambda k: C[p[-1]][k])
            p.append(j)
            rest.remove(j)
        if pin_last:
            p.append(n - 1)
        if best is None or path_cost(p) < path_cost(best):
            best = p
    improved = True
    lo = 1 if pin_first else 0
    hi = n - 1 if pin_last else n
    while improved:
        improved = False
        for i, j in itertools.combinations(range(lo, hi), 2):
            if j - i < 1:
                continue
            q = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
            if path_cost(q) + 1e-9 < path_cost(best):
                best, improved = q, True
    return best
