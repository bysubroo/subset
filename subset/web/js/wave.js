// rekordbox-style 3-band waveform rendering
const C = { low: "#2F6BFF", mid: "#FF9F1C", high: "#F2F2F2" };

// wf = {rate, low[], mid[], high[]} (0..255); draws time range [t0,t1] into rect
export function drawWave(ctx, wf, t0, t1, x0, y0, w, h, { alpha = 1, mirror = true } = {}) {
  if (!wf || !wf.low || w <= 0) return;
  const rate = wf.rate, n = wf.low.length, mid = y0 + h / 2, s = (mirror ? h / 2 : h) / 255;
  const span = t1 - t0;
  ctx.globalAlpha = alpha;
  const bands = [["low", 1, C.low], ["mid", 0.82, C.mid], ["high", 0.52, C.high]];
  const W = Math.ceil(w);
  const vals = [new Float32Array(W), new Float32Array(W), new Float32Array(W)];
  for (let px = 0; px < W; px++) {
    let a = Math.floor((t0 + span * px / w) * rate), b = Math.floor((t0 + span * (px + 1) / w) * rate);
    if (b <= a) b = a + 1;
    if (b <= 0 || a >= n) continue;
    a = Math.max(0, a); b = Math.min(n, b);
    let L = 0, M = 0, H = 0;
    for (let i = a; i < b; i++) { if (wf.low[i] > L) L = wf.low[i]; if (wf.mid[i] > M) M = wf.mid[i]; if (wf.high[i] > H) H = wf.high[i]; }
    vals[0][px] = L; vals[1][px] = M; vals[2][px] = H;
  }
  bands.forEach(([, k, col], bi) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    const v = vals[bi];
    for (let px = 0; px < W; px++) {
      const hh = v[px] * s * k;
      if (hh < 0.4) continue;
      if (mirror) ctx.rect(x0 + px, mid - hh, 1, hh * 2);
      else ctx.rect(x0 + px, y0 + h - hh, 1, hh);
    }
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// small 160-point preview {low,mid,high}
export function drawPreview(ctx, pv, x0, y0, w, h, alpha = 1) {
  if (!pv || !pv.low || !pv.low.length) return;
  const n = pv.low.length;
  drawWave(ctx, { rate: n, low: pv.low, mid: pv.mid, high: pv.high }, 0, 1, x0, y0, w, h, { alpha, mirror: false });
}

export const PHRASE = { intro: "#3B6CF0", verse: "#19A97B", build: "#E8812A", drop: "#E2475B", chorus: "#C95AD8", break: "#7B61FF", outro: "#3B6CF0" };
export const PHRASE_SR = { intro: "INTRO", verse: "VERSE", build: "BUILD", drop: "DROP", chorus: "REFREN", break: "BREAK", outro: "OUTRO" };
