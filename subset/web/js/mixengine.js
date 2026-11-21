// Live set playback (Web Audio): plays the planned mix with real transitions, tempo sync (re-pitch),
// bass swap EQ, filter sweeps, echo out and SFX — no rendering needed.
import { esc } from "./util.js";
import { drawWave } from "./wave.js";

const LOOKAHEAD = 14;     // seconds of timeline scheduled ahead
const PREFETCH = 45;      // decode tracks starting within this window
const XO = 160;           // bass swap crossover (Hz)

export class MixEngine {
  constructor() {
    this.ctx = null;
    this.plan = null;
    this.tracks = {};        // id -> full track (for waveforms)
    this.buffers = new Map(); // track_id -> Promise<AudioBuffer>
    this.sfx = new Map();
    this.playing = false;
    this.pos = 0;            // timeline position when paused
    this.nodes = [];
    this.scheduled = new Set();
    this.timer = null;
    this.vol = 0.9;
    this.onChange = () => {};
  }

  _ctx() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "playback" });
      this.master = this.ctx.createGain();
      this.limiter = this.ctx.createDynamicsCompressor();
      Object.assign(this.limiter, {});
      this.limiter.threshold.value = -3; this.limiter.knee.value = 2; this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003; this.limiter.release.value = 0.12;
      this.master.gain.value = this.vol;
      this.master.connect(this.limiter).connect(this.ctx.destination);
    }
    return this.ctx;
  }

  setPlan(plan, tracks) {
    const wasPlaying = this.playing, t = this.time();
    if (wasPlaying) this._stopNodes();
    this.plan = plan;
    this.tracks = tracks;
    this.maps = plan.entries.map(e => buildMap(e));
    this.pos = Math.min(t, plan.total);
    if (wasPlaying) this.play(this.pos);
  }

  // ---------------- transport interface
  isPlaying() { return this.playing; }
  duration() { return this.plan?.total || 0; }
  time() {
    if (!this.playing) return this.pos;
    return Math.min(this.duration(), this.t0 + (this.ctx.currentTime - this.c0));
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  seek(t) { t = Math.max(0, Math.min(this.duration(), t)); if (this.playing) this.play(t); else { this.pos = t; this.onChange(); } }
  pause() { if (!this.playing) return; this.pos = this.time(); this._stopNodes(); this.playing = false; this.onChange(); }
  prev() { const e = this.currentEntry(); if (!e) return; const i = e.idx; const t = this.time(); this.seek(t - e.t_start > 3 || i === 0 ? e.t_start : this.plan.entries[i - 1].t_start); }
  next() { const e = this.currentEntry(); if (!e) return; const n = this.plan.entries[e.idx + 1]; if (n) this.seek(n.t_start); }
  currentEntry(t = this.time()) {
    if (!this.plan) return null;
    let cur = null;
    for (const e of this.plan.entries) if (t >= e.t_start - 0.01 && t < e.t_end) cur = e;  // latest started wins during overlap
    return cur || this.plan.entries[this.plan.entries.length - 1];
  }
  info() {
    const e = this.currentEntry();
    if (!e) return { title: "Prazan set" };
    return { title: e.title, sub: `${esc(e.artist || "")} · <span class="mono">${e.idx + 1}/${this.plan.entries.length} · ${e.bpm.toFixed(1)} BPM · ${e.camelot}</span>`, art: e.track_id };
  }
  drawOverview(c, w, h) {
    if (!this.plan) return;
    const T = this.plan.total || 1;
    this.plan.entries.forEach((e, i) => {
      const t = this.tracks[e.track_id]; if (!t?.analysis) return;
      const x0 = e.t_start / T * w, x1 = e.t_end / T * w;
      const srcSpan = (e.end_src - e.in_src);
      drawWave(c, t.analysis.waveform, e.in_src, e.in_src + srcSpan, x0, 2, Math.max(1, x1 - x0), h - 4, { alpha: i % 2 ? .75 : .95 });
    });
  }

  async play(from = this.pos) {
    if (!this.plan || !this.plan.entries.length) return;
    const ctx = this._ctx();
    if (ctx.state === "suspended") await ctx.resume();
    this._stopNodes();
    this.playing = true;
    this.t0 = from;
    this.c0 = ctx.currentTime + 0.15;
    this.scheduled.clear();
    // make sure the buffers needed right now are ready before starting the clock
    const now = this.plan.entries.filter(e => e.t_end > from && e.t_start < from + 2);
    await Promise.all(now.map(e => this._buf(e.track_id)));
    if (!this.playing || this.t0 !== from) return;
    this.c0 = ctx.currentTime + 0.08;
    this._tick();
    this.timer = setInterval(() => this._tick(), 250);
    this.onChange();
  }

  _stopNodes() {
    clearInterval(this.timer); this.timer = null;
    for (const n of this.nodes) { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} }
    this.nodes = [];
    this.scheduled.clear();
  }

  _buf(id) {
    if (!this.buffers.has(id)) {
      const p = fetch("/api/audio/" + id).then(r => r.arrayBuffer()).then(b => this._ctx().decodeAudioData(b));
      p.catch(() => this.buffers.delete(id));
      this.buffers.set(id, p);
    }
    return this.buffers.get(id);
  }

  _tick() {
    if (!this.playing) return;
    const t = this.time();
    if (t >= this.duration() - 0.05) { this.pause(); this.pos = 0; this.onChange(); return; }
    const p = this.plan;
    p.entries.forEach((e, i) => {
      if (e.t_start < t + PREFETCH && e.t_end > t) this._buf(e.track_id);
      if (this.scheduled.has(i) || e.t_end <= t || e.t_start > t + LOOKAHEAD) return;
      this.scheduled.add(i);
      this._buf(e.track_id).then(buf => { if (this.playing) this._schedule(i, buf); });
    });
    for (const tr of p.transitions) {
      if (!tr.sfx || this.scheduled.has("s" + tr.idx) || tr.t_start < t || tr.t_start > t + LOOKAHEAD) continue;
      this.scheduled.add("s" + tr.idx);
      this._sfx(tr.sfx).then(buf => {
        if (!this.playing || !buf) return;
        const s = this.ctx.createBufferSource(); s.buffer = buf;
        const g = this.ctx.createGain(); g.gain.value = 0.7;
        s.connect(g).connect(this.master);
        s.start(this._ct(tr.t_start));
        this.nodes.push(s, g);
      });
    }
    // free buffers far behind the playhead
    const keep = new Set(p.entries.filter(e => e.t_end > t - 5 && e.t_start < t + PREFETCH + 30).map(e => e.track_id));
    for (const id of [...this.buffers.keys()]) if (!keep.has(id) && this.buffers.size > 4) this.buffers.delete(id);
  }

  _sfx(name) {
    if (!this.sfx.has(name)) this.sfx.set(name, fetch("/api/sfx_file/" + encodeURIComponent(name)).then(r => r.ok ? r.arrayBuffer() : null).then(b => b ? this._ctx().decodeAudioData(b) : null).catch(() => null));
    return this.sfx.get(name);
  }

  _ct(t) { return this.c0 + (t - this.t0); }   // timeline -> context time

  _schedule(i, buf) {
    const ctx = this.ctx, e = this.plan.entries[i], map = this.maps[i];
    const tin = this.plan.transitions[i - 1], tout = this.plan.transitions[i];
    const now = this.time() + 0.05;
    const startT = Math.max(e.t_start, now);
    if (startT >= e.t_end) return;
    const when = this._ct(startT);
    const srcOff = srcAt(map, startT);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    // tempo (re-pitch): playbackRate follows the plan's speed curve
    const rateSegs = speedCurve(map, startT, e.t_end);
    if (rateSegs.constant) src.playbackRate.value = rateSegs.value;
    else { src.playbackRate.setValueAtTime(rateSegs.points[0][1], when); for (const [t, v] of rateSegs.points.slice(1)) src.playbackRate.linearRampToValueAtTime(v, this._ct(t)); }

    const bassMode = (tin && tin.type === "bass") || (tout && tout.type === "bass");
    const vol = ctx.createGain();
    const filt = ctx.createBiquadFilter(); filt.type = "allpass"; filt.frequency.value = 1000;
    let gLow = null, gHigh = null;
    if (bassMode) {
      const lp1 = bq(ctx, "lowpass", XO), lp2 = bq(ctx, "lowpass", XO), hp1 = bq(ctx, "highpass", XO), hp2 = bq(ctx, "highpass", XO);
      gLow = ctx.createGain(); gHigh = ctx.createGain();
      src.connect(lp1).connect(lp2).connect(gLow).connect(filt);
      src.connect(hp1).connect(hp2).connect(gHigh).connect(filt);
      this.nodes.push(lp1, lp2, hp1, hp2, gLow, gHigh);
    } else src.connect(filt);
    filt.connect(vol).connect(this.master);
    this.nodes.push(src, vol, filt);

    const A = (param, t0, t1, fn) => automate(param, t0, t1, fn, startT, x => this._ct(x));

    // incoming
    if (tin) {
      const L0 = tin.t_start, L1 = tin.t_end;
      if (L1 > L0 && ["blend", "high_low", "low_high"].includes(tin.type)) A(vol.gain, L0, L1, x => Math.sin(x * Math.PI / 2));
      else if (L1 > L0 && tin.type === "bass") { A(gHigh.gain, L0, L1, x => Math.sin(x * Math.PI / 2)); A(gLow.gain, L0, L1, x => x < 0.5 ? 0 : 1); }
    }
    // outgoing
    if (tout) {
      const L0 = tout.t_start, L1 = tout.t_end;
      if (tout.type === "blend" && L1 > L0) A(vol.gain, L0, L1, x => Math.cos(x * Math.PI / 2));
      else if (tout.type === "bass" && L1 > L0) { A(gHigh.gain, L0, L1, x => Math.cos(x * Math.PI / 2)); A(gLow.gain, L0, L1, x => x < 0.5 ? 1 : 0); }
      else if ((tout.type === "high_low" || tout.type === "low_high") && L1 > L0) {
        filt.type = tout.type === "high_low" ? "lowpass" : "highpass";
        filt.Q.value = 0.9;
        const f0 = tout.type === "high_low" ? 18000 : 30, f1 = tout.type === "high_low" ? 180 : 2000;
        filt.frequency.value = f0;
        A(filt.frequency, L0, L1, x => f0 * Math.pow(f1 / f0, x));
        A(vol.gain, L0, L1, x => x < 0.75 ? 1 : Math.cos((x - 0.75) / 0.25 * Math.PI / 2));
      } else if (tout.type === "cut") {
        A(vol.gain, L0, L0 + 0.012, x => 1 - x);
      } else if (tout.type === "echo") {
        const beat = 60 / (e.bpm * (e.speed_pts.at(-1)?.[1] || 1));
        const dl = ctx.createDelay(4); dl.delayTime.value = beat * 0.75;
        const fb = ctx.createGain(); fb.gain.value = 0.55;
        const hp = bq(ctx, "highpass", 250);
        const send = ctx.createGain(); send.gain.value = 0;
        const wet = ctx.createGain(); wet.gain.value = 0.9;
        filt.connect(send).connect(dl).connect(hp).connect(wet).connect(this.master);
        hp.connect(fb).connect(dl);
        A(send.gain, L0, L0 + 0.02, x => x);
        A(vol.gain, L0, L0 + beat * 4, x => 1 - x * 0.85);
        this.nodes.push(dl, fb, hp, send, wet);
      }
    }
    src.start(when, Math.max(0, srcOff));
    src.stop(this._ct(e.t_end) + 0.02);
  }
}

function bq(ctx, type, f) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Math.SQRT1_2; return b; }

// schedule fn(x) for x in 0..1 across timeline [t0,t1], starting no earlier than playback start
function automate(param, t0, t1, fn, startT, ct) {
  if (t1 <= startT) { param.setValueAtTime(fn(1), ct(startT)); return; }
  const a = Math.max(t0, startT);
  const x0 = t1 > t0 ? (a - t0) / (t1 - t0) : 1;
  param.setValueAtTime(fn(t0 >= startT ? 0 : x0), ct(Math.max(startT, a)));
  if (t0 > startT) param.setValueAtTime(fn(0), ct(t0));
  const n = Math.max(2, Math.min(256, Math.ceil((t1 - a) * 40)));
  const curve = new Float32Array(n);
  for (let k = 0; k < n; k++) curve[k] = fn(x0 + (1 - x0) * k / (n - 1));
  try { param.setValueCurveAtTime(curve, ct(a), Math.max(0.005, t1 - a)); }
  catch { param.linearRampToValueAtTime(fn(1), ct(t1)); }
}

// timeline <-> source mapping from the plan's piecewise-linear speed curve
function buildMap(e) {
  const pts = e.speed_pts.length ? e.speed_pts : [[e.in_src, 1]];
  const sp = s => {
    if (s <= pts[0][0]) return pts[0][1];
    for (let k = 1; k < pts.length; k++) if (s <= pts[k][0]) { const [s0, v0] = pts[k - 1], [s1, v1] = pts[k]; return v0 + (v1 - v0) * (s - s0) / (s1 - s0); }
    return pts[pts.length - 1][1];
  };
  const step = 0.05, S = [], T = [], V = [];
  let t = e.t_start;
  for (let s = e.in_src; s <= e.end_src + step; s += step) { S.push(s); T.push(t); V.push(sp(s)); t += step / sp(s); }
  return { S, T, V };
}
function srcAt(m, t) {
  const { S, T } = m;
  if (t <= T[0]) return S[0];
  let lo = 0, hi = T.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
  const f = (t - T[lo]) / ((T[hi] - T[lo]) || 1);
  return S[lo] + f * (S[hi] - S[lo]);
}
function speedCurve(m, t0, t1) {
  const pts = [];
  let prev = null;
  for (let k = 0; k < m.T.length; k++) {
    if (m.T[k] < t0 - 0.05 || m.T[k] > t1) continue;
    if (prev !== null && Math.abs(m.V[k] - prev) < 1e-5 && k % 20) continue;
    pts.push([Math.max(t0, m.T[k]), m.V[k]]); prev = m.V[k];
  }
  const vals = pts.map(p => p[1]);
  if (!pts.length || Math.max(...vals) - Math.min(...vals) < 1e-5) return { constant: true, value: vals[0] ?? 1 };
  return { constant: false, points: pts };
}
