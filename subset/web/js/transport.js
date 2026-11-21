// Bottom transport bar: drives whichever source is active (library deck or live set mix)
import { $, fmt, sizeCanvas, setArt, esc } from "./util.js";

let source = null;
let volume = 0.9;
const listeners = new Set();

export function setSource(src) {
  if (source && source !== src && source.isPlaying()) source.pause();
  source = src;
  src.setVolume?.(volume);
  render();
}
export const getSource = () => source;
export function onTick(fn) { listeners.add(fn); }

function render() {
  const play = $("#tp-play-ico");
  const playing = source?.isPlaying();
  play.innerHTML = playing
    ? '<rect x="5.5" y="4.5" width="3" height="11" rx=".6" fill="currentColor"/><rect x="11.5" y="4.5" width="3" height="11" rx=".6" fill="currentColor"/>'
    : '<path d="M7 4.8l8.6 5.2L7 15.2z" fill="currentColor"/>';
  const info = source?.info?.() || {};
  $("#tp-title").textContent = info.title || "—";
  $("#tp-sub").innerHTML = info.sub || "";
  const art = $("#tp-art");
  if (art.dataset.id !== String(info.art || "")) { art.dataset.id = info.art || ""; setArt(art, info.art); }
  $("#tp-cur").textContent = fmt(source?.time() || 0);
  $("#tp-dur").textContent = fmt(source?.duration() || 0);
  const [c, w, h] = sizeCanvas($("#tp-canvas"));
  c.clearRect(0, 0, w, h);
  if (source?.drawOverview) source.drawOverview(c, w, h);
  const d = source?.duration() || 0;
  if (d > 0) {
    const x = (source.time() / d) * w;
    c.fillStyle = "rgba(14,15,17,.55)";
    c.fillRect(0, 0, x, h);
    c.fillStyle = "#E04FD0";
    c.fillRect(Math.round(x), 0, 2, h);
  }
}

function loop() {
  if (source) {
    render();
    for (const fn of listeners) fn(source);
  }
  requestAnimationFrame(loop);
}

export function initTransport() {
  $("#tp-play").onclick = () => toggle();
  $("#tp-prev").onclick = () => source?.prev?.();
  $("#tp-next").onclick = () => source?.next?.();
  $("#tp-vol").oninput = e => { volume = +e.target.value; source?.setVolume?.(volume); };
  $("#tp-canvas").onclick = e => {
    if (!source) return;
    const r = e.target.getBoundingClientRect();
    source.seek((e.clientX - r.left) / r.width * source.duration());
  };
  window.addEventListener("resize", render);
  requestAnimationFrame(loop);
}

export function toggle() {
  if (!source) return;
  source.isPlaying() ? source.pause() : source.play();
}
