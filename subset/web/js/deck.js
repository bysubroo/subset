// Library deck: zoomed + overview waveform, hot cues, preview playback
import { $, api, esc, fmt, keyChip, energyBars, rgb, setArt, sizeCanvas } from "./util.js";
import { drawWave, PHRASE, PHRASE_SR } from "./wave.js";
import { setSource } from "./transport.js";

const audio = new Audio();
audio.preload = "auto";
const cache = new Map();
let T = null;          // loaded track (full)
let zoomSpan = 14;     // seconds visible in zoomed view
let onLoaded = () => {};

export const deckTrack = () => T;
export function onDeckLoaded(fn) { onLoaded = fn; }

export async function getFull(id) {
  if (!cache.has(id)) cache.set(id, await api("/tracks/" + id));
  return cache.get(id);
}
export function invalidate(id) { cache.delete(id); }

export const deckSource = {
  play() { if (T) audio.play(); },
  pause() { audio.pause(); },
  isPlaying: () => !audio.paused,
  time: () => audio.currentTime || 0,
  duration: () => T?.analysis?.duration || audio.duration || 0,
  seek(t) { audio.currentTime = Math.max(0, t); },
  setVolume(v) { audio.volume = v; },
  info() {
    if (!T) return { title: "Ništa nije učitano" };
    const a = T.analysis || {};
    return { title: T.title, sub: `${esc(T.artist || "")}${a.bpm ? ` · <span class="mono">${a.bpm.toFixed(1)} BPM · ${a.camelot}</span>` : ""}`, art: T.id };
  },
  drawOverview(c, w, h) { if (T?.analysis) drawWave(c, T.analysis.waveform, 0, T.analysis.duration, 0, 2, w, h - 4, { alpha: .9 }); },
  prev() { jumpCue(-1); },
  next() { jumpCue(1); },
};

function jumpCue(dir) {
  if (!T) return;
  const t = audio.currentTime;
  const marks = [0, ...T.cues.map(c => c.time)].sort((a, b) => a - b);
  const target = dir > 0 ? marks.find(m => m > t + 0.25) : [...marks].reverse().find(m => m < t - 0.6);
  if (target !== undefined) audio.currentTime = target;
}

export async function loadDeck(id, autoplay = false) {
  const t = await getFull(id);
  T = t;
  const a = t.analysis;
  audio.src = "/api/audio/" + id;
  $("#deck-title").textContent = t.title || "";
  $("#deck-artist").textContent = t.artist || "";
  setArt($("#deck-art"), id);
  $("#deck-stats").innerHTML = a ? `
    <span class="chip"><b>${a.bpm.toFixed(2)}</b> BPM</span>
    <span class="chip">${keyChip(a.camelot)} <b>${esc(a.key)}</b></span>
    <span class="chip" title="Energija ${a.energy}/10 · grid ${a.grid.type === "constant" ? "fiksni" : "dinamički"}">${energyBars(a.energy)}<b>${a.energy}</b></span>` : '<span class="chip">Analiza u toku…</span>';
  const hot = (t.cues || []).filter(c => c.type === "hot");
  const slots = "ABCDEFGH".slice(0, Math.max(3, hot.length));
  $("#deck-cues").innerHTML = [...slots].map(s => {
    const c = hot.find(h => h.slot === s);
    return c ? `<button class="hotcue" data-t="${c.time}" title="${esc(c.name)} · ${fmt(c.time)}"><span class="cue-chip" style="background:${rgb(c.color)}">${s}</span><span>${esc(c.name)}</span></button>`
      : `<div class="hotcue empty"><span class="cue-chip" style="background:#2A2E34;color:#5B616B">${s}</span><span>prazno</span></div>`;
  }).join("");
  setSource(deckSource);
  draw();
  onLoaded(t);
  if (autoplay) audio.play();
}

export function initDeck() {
  $("#deck-cues").onclick = e => {
    const b = e.target.closest("[data-t]");
    if (b) { audio.currentTime = +b.dataset.t; audio.play(); setSource(deckSource); }
  };
  const zoom = $("#deck-zoom"), ov = $("#deck-overview");
  let drag = null;
  zoom.addEventListener("mousedown", e => { if (!T) return; drag = { x: e.clientX, t: audio.currentTime }; });
  window.addEventListener("mousemove", e => {
    if (!drag) return;
    const w = zoom.getBoundingClientRect().width;
    audio.currentTime = Math.max(0, drag.t - (e.clientX - drag.x) / w * zoomSpan);
    draw();
  });
  window.addEventListener("mouseup", () => { drag = null; });
  zoom.addEventListener("wheel", e => { e.preventDefault(); zoomSpan = Math.min(90, Math.max(4, zoomSpan * (e.deltaY > 0 ? 1.15 : 1 / 1.15))); draw(); }, { passive: false });
  ov.onclick = e => { if (!T) return; const r = ov.getBoundingClientRect(); audio.currentTime = (e.clientX - r.left) / r.width * T.analysis.duration; draw(); };
  window.addEventListener("resize", draw);
  (function loop() { if (T && !audio.paused) draw(); requestAnimationFrame(loop); })();
  audio.addEventListener("seeked", draw);
  draw();
}

export function draw() {
  const zc = $("#deck-zoom"), oc = $("#deck-overview");
  let [c, W, H] = sizeCanvas(zc);
  c.fillStyle = "#08090A"; c.fillRect(0, 0, W, H);
  if (!T || !T.analysis) {
    c.fillStyle = "#3A3F47"; c.font = "600 12px Satoshi"; c.textAlign = "center";
    c.fillText(T ? "Analiza u toku…" : "Nema učitane pesme", W / 2, H / 2 + 4);
    c.textAlign = "left";
    [c, W, H] = sizeCanvas(oc); c.fillStyle = "#08090A"; c.fillRect(0, 0, W, H);
    return;
  }
  const a = T.analysis, cur = audio.currentTime || 0, bpm = a.bpm;
  const t0 = cur - zoomSpan / 2, t1 = cur + zoomSpan / 2;
  const X = t => (t - t0) / zoomSpan * W;
  const top = 16, bot = H - 2;
  // phrases
  for (const p of a.phrases) {
    const s = p.start, e = s + p.bars * 240 / bpm;
    if (e < t0 || s > t1) continue;
    const col = PHRASE[p.label] || "#555";
    c.fillStyle = col + "1F"; c.fillRect(X(s), top, X(e) - X(s), bot - top);
    c.fillStyle = col; c.fillRect(X(s), 0, Math.max(0, X(e) - X(s) - 1), 3);
    c.fillStyle = "#8A9099"; c.font = "700 9.5px Satoshi"; c.fillText(PHRASE_SR[p.label] || p.label, X(s) + 5, 12);
  }
  drawWave(c, a.waveform, t0, t1, 0, top, W, bot - top);
  // grid
  for (const b of a.grid.beats) { if (b < t0 || b > t1) continue; c.fillStyle = "rgba(255,255,255,.14)"; c.fillRect(Math.round(X(b)), top, 1, 6); c.fillRect(Math.round(X(b)), bot - 6, 1, 6); }
  for (const b of a.grid.downbeats) { if (b < t0 || b > t1) continue; c.fillStyle = "rgba(242,85,90,.85)"; c.fillRect(Math.round(X(b)), top, 1.5, 10); c.fillRect(Math.round(X(b)), bot - 10, 1.5, 10); }
  // cues
  for (const q of T.cues) {
    const x = X(q.time); if (x < -20 || x > W + 20) continue;
    c.fillStyle = rgb(q.color);
    if (q.type === "hot") {
      c.globalAlpha = .9; c.fillRect(Math.round(x), top, 1.5, bot - top); c.globalAlpha = 1;
      c.beginPath(); c.roundRect ? c.roundRect(x, top, 15, 13, 2) : c.rect(x, top, 15, 13); c.fill();
      c.fillStyle = "#0A0A0A"; c.font = "800 9.5px Satoshi"; c.fillText(q.slot, x + 4.5, top + 10);
    } else {
      c.beginPath(); c.moveTo(x - 4, bot); c.lineTo(x + 4, bot); c.lineTo(x, bot - 6); c.fill();
    }
  }
  // playhead
  c.fillStyle = "#E04FD0"; c.fillRect(Math.round(W / 2) - 1, 0, 2, H);
  c.fillStyle = "#0B0C0E"; c.fillRect(W - 70, 0, 70, 15);
  c.fillStyle = "#B4BAC3"; c.font = "500 10px 'Plex Mono'"; c.textAlign = "right"; c.fillText(fmt(cur) + " / " + fmt(a.duration), W - 6, 11); c.textAlign = "left";

  // overview
  [c, W, H] = sizeCanvas(oc);
  c.fillStyle = "#08090A"; c.fillRect(0, 0, W, H);
  for (const p of a.phrases) { const s = p.start / a.duration * W, e = (p.start + p.bars * 240 / bpm) / a.duration * W; c.fillStyle = PHRASE[p.label]; c.fillRect(s, H - 3, Math.max(0, e - s - 1), 3); }
  drawWave(c, a.waveform, 0, a.duration, 0, 2, W, H - 6, { alpha: .9 });
  const vx0 = t0 / a.duration * W, vx1 = t1 / a.duration * W;
  c.fillStyle = "rgba(255,255,255,.06)"; c.fillRect(vx0, 0, vx1 - vx0, H);
  for (const q of T.cues.filter(q => q.type === "hot")) { c.fillStyle = rgb(q.color); c.fillRect(q.time / a.duration * W, 0, 2, H - 3); }
  c.fillStyle = "#E04FD0"; c.fillRect(cur / a.duration * W, 0, 2, H);
}
