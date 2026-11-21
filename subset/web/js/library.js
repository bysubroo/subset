// Library: sidebar, Camelot filter wheel, virtualized track table
import { $, $$, api, esc, fmt, keyChip, keyColor, energyBars, rgb, setArt, toast, pickFolder, sizeCanvas } from "./util.js";
import { drawPreview } from "./wave.js";
import { loadDeck, deckTrack, onDeckLoaded } from "./deck.js";

export let TRACKS = [];
let view = [];
let sel = null;
let src = "all";
let folder = null;
let sortKey = "artist", sortDir = 1;
const keys = new Set();
const ROW = 32;

const COLS = [
  { k: "status", label: "", w: "22px" },
  { k: "preview", label: "Preview", w: "136px", nosort: true },
  { k: "art", label: "", w: "34px", nosort: true },
  { k: "title", label: "Naziv", w: "minmax(160px,1.5fr)" },
  { k: "artist", label: "Izvođač", w: "minmax(120px,1fr)" },
  { k: "bpm", label: "BPM", w: "68px", r: true },
  { k: "camelot", label: "Key", w: "58px" },
  { k: "energy", label: "Energ.", w: "62px" },
  { k: "cues", label: "Cue", w: "74px", nosort: true },
  { k: "duration", label: "Vreme", w: "62px", r: true },
  { k: "added", label: "Dodato", w: "96px", r: true },
];
const GRID = COLS.map(c => c.w).join(" ");

export function initLibrary() {
  const head = $("#lib-head");
  head.style.gridTemplateColumns = GRID;
  head.innerHTML = COLS.map(c => `<div data-k="${c.k}" class="${c.r ? "r" : ""}">${c.label}</div>`).join("");
  head.onclick = e => {
    const d = e.target.closest("[data-k]"); if (!d) return;
    const c = COLS.find(x => x.k === d.dataset.k); if (c.nosort) return;
    sortDir = sortKey === c.k ? -sortDir : 1; sortKey = c.k; apply();
  };
  $("#lib-body").addEventListener("scroll", paint);
  window.addEventListener("resize", paint);
  $("#lib-body").addEventListener("click", e => {
    const r = e.target.closest(".row"); if (!r) return;
    select(+r.dataset.id, false);
  });
  $("#lib-body").addEventListener("dblclick", e => {
    const r = e.target.closest(".row"); if (!r) return;
    select(+r.dataset.id, true);
  });
  document.addEventListener("keydown", e => {
    if (!$("#v-library").classList.contains("on") || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = view.findIndex(t => t.id === sel);
      const n = Math.max(0, Math.min(view.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      if (view[n]) { select(view[n].id, false); ensureVisible(n); }
    }
  });
  $("#lib-search").addEventListener("input", apply);
  for (const id of ["f-bpm-min", "f-bpm-max", "f-en-min", "f-en-max", "f-compat"]) $("#" + id).addEventListener("input", apply);
  $("#btn-reset-filters").onclick = () => {
    keys.clear(); for (const id of ["f-bpm-min", "f-bpm-max", "f-en-min", "f-en-max"]) $("#" + id).value = "";
    $("#f-compat").checked = false; drawWheel(); apply();
  };
  $$("#lib-side [data-src]").forEach(b => b.onclick = () => { src = b.dataset.src; folder = null; sideState(); apply(); });
  $("#folder-list").onclick = e => {
    const b = e.target.closest("[data-folder]"); if (!b) return;
    src = "folder"; folder = b.dataset.folder; sideState(); apply();
  };
  for (const id of ["btn-add-folder", "btn-add-folder-2", "btn-add-folder-3"]) $("#" + id).onclick = addFolder;
  $("#btn-rescan").onclick = async () => { const r = await api("/rescan", { body: {} }); toast(`Pregledano ${r.found} pesama · ${r.new} novih ili izmenjenih`); refresh(); };
  onDeckLoaded(() => { if ($("#f-compat").checked) apply(); else paint(); });
  drawWheel();
}

async function addFolder() {
  const p = await pickFolder(); if (!p) return;
  try {
    const r = await api("/scan", { body: { path: p } });
    toast(`<b>${r.found}</b> pesama u folderu · <b>${r.new}</b> ide na analizu`, { kind: "ok" });
    refresh();
  } catch (e) { toast(esc(e.message), { kind: "err" }); }
}

function sideState() {
  $$("#lib-side [data-src]").forEach(b => b.classList.toggle("on", src === b.dataset.src));
  $$("#folder-list [data-folder]").forEach(b => b.classList.toggle("on", src === "folder" && folder === b.dataset.folder));
}

export function setFolders(list) {
  const el = $("#folder-list");
  const html = list.map(f => {
    const name = f.split(/[\\/]/).filter(Boolean).pop() || f;
    return `<button class="side-item" data-folder="${esc(f)}" title="${esc(f)}"><span>${esc(name)}</span></button>`;
  }).join("") || '<div class="hint" style="padding:2px 8px 4px;font-size:12px">Još nema foldera</div>';
  if (el.innerHTML !== html) { el.innerHTML = html; sideState(); }
}

export async function refresh() {
  TRACKS = await api("/tracks");
  apply();
}

function compatSet(cam) {
  if (!cam) return null;
  const n = parseInt(cam), l = cam.slice(-1), o = l === "A" ? "B" : "A";
  const w = x => ((x - 1 + 12) % 12) + 1;
  return new Set([`${n}${l}`, `${w(n + 1)}${l}`, `${w(n - 1)}${l}`, `${n}${o}`]);
}

function apply() {
  const q = $("#lib-search").value.trim().toLowerCase();
  const bmin = +$("#f-bpm-min").value || 0, bmax = +$("#f-bpm-max").value || 999;
  const emin = +$("#f-en-min").value || 0, emax = +$("#f-en-max").value || 99;
  const comp = $("#f-compat").checked ? compatSet(deckTrack()?.analysis?.camelot) : null;
  const weekAgo = Date.now() / 1000 - 7 * 86400;
  view = TRACKS.filter(t => {
    if (src === "recent" && !(t.added > weekAgo)) return false;
    if (src === "pending" && t.status === "ok") return false;
    if (src === "folder" && !(t.path || "").startsWith(folder)) return false;
    if (q && !`${t.artist} ${t.title} ${t.camelot} ${t.key} ${t.bpm ? Math.round(t.bpm) : ""}`.toLowerCase().includes(q)) return false;
    if (keys.size && !keys.has(t.camelot)) return false;
    if (comp && !comp.has(t.camelot)) return false;
    if ((bmin || bmax < 999) && !(t.bpm >= bmin && t.bpm <= bmax)) return false;
    if ((emin || emax < 99) && !(t.energy >= emin && t.energy <= emax)) return false;
    return true;
  });
  const k = sortKey;
  view.sort((a, b) => {
    let x = a[k], y = b[k];
    if (k === "camelot") { x = x ? parseInt(x) * 2 + (x.endsWith("B") ? 1 : 0) : 99; y = y ? parseInt(y) * 2 + (y.endsWith("B") ? 1 : 0) : 99; }
    if (typeof x === "string" || typeof y === "string") return (x || "").localeCompare(y || "", "sr") * sortDir;
    return ((x ?? -1) - (y ?? -1)) * sortDir;
  });
  $$("#lib-head > div").forEach(d => { d.classList.toggle("sorted", d.dataset.k === sortKey); d.classList.toggle("asc", sortDir < 0); });
  $("#cnt-all").textContent = TRACKS.length;
  $("#cnt-recent").textContent = TRACKS.filter(t => t.added > weekAgo).length;
  $("#cnt-pending").textContent = TRACKS.filter(t => t.status !== "ok").length;
  $("#lib-count").textContent = view.length === TRACKS.length ? `${TRACKS.length} pesama` : `${view.length} od ${TRACKS.length}`;
  $("#lib-empty").hidden = TRACKS.length > 0;
  $("#lib-space").style.height = view.length * ROW + "px";
  paint(true);
}

const pool = new Map();
function paint(force = false) {
  const body = $("#lib-body");
  const top = body.scrollTop, h = body.clientHeight;
  const i0 = Math.max(0, Math.floor(top / ROW) - 6), i1 = Math.min(view.length, Math.ceil((top + h) / ROW) + 6);
  const want = new Set();
  const loaded = deckTrack()?.id;
  for (let i = i0; i < i1; i++) {
    const t = view[i];
    const key = t.id;
    want.add(key);
    let el = pool.get(key);
    const sig = `${t.status}|${t.bpm}|${t.camelot}|${sel === t.id}|${loaded === t.id}|${(t.cues || []).length}`;
    if (!el) {
      el = document.createElement("div");
      el.className = "row";
      el.style.gridTemplateColumns = GRID;
      el.dataset.id = t.id;
      $("#lib-space").appendChild(el);
      pool.set(key, el);
    }
    el.style.top = i * ROW + "px";
    if (el._sig !== sig || force) { el._sig = sig; fill(el, t, loaded); }
  }
  for (const [k, el] of pool) if (!want.has(k)) { el.remove(); pool.delete(k); }
}

function fill(el, t, loaded) {
  el.classList.toggle("sel", sel === t.id);
  el.classList.toggle("loaded", loaded === t.id);
  const st = t.status === "ok" ? "ok" : t.status === "analyzing" ? "run" : t.status === "error" ? "err" : "new";
  const stTitle = { ok: "Analizirano", run: "Analiza u toku", err: "Greška: " + (t.error || ""), new: "Čeka analizu" }[st];
  const cues = (t.cues || []).slice(0, 4).map(c => `<span class="cue-chip" style="background:${rgb(c.color)}" title="${esc(c.name)} ${fmt(c.time)}">${c.slot}</span>`).join("");
  const added = t.added ? new Date(t.added * 1000).toLocaleDateString("sr-RS", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  el.innerHTML = `
    <div><span class="status-dot ${st}" title="${esc(stTitle)}"></span></div>
    <div><canvas class="pv"></canvas></div>
    <div style="padding:0 4px"><span class="art xs"></span></div>
    <div><span class="t-title">${esc(t.title)}</span></div>
    <div><span class="t-artist">${esc(t.artist || "")}</span></div>
    <div class="r num">${t.bpm ? t.bpm.toFixed(1) : "–"}</div>
    <div>${keyChip(t.camelot)}</div>
    <div>${energyBars(t.energy)}<span class="num" style="color:var(--faint)">${t.energy ?? ""}</span></div>
    <div style="gap:3px">${cues}</div>
    <div class="r num">${fmt(t.duration)}</div>
    <div class="r num" style="color:var(--faint)">${added}</div>`;
  setArt(el.querySelector(".art"), t.status === "ok" ? t.id : null);
  const cv = el.querySelector("canvas");
  requestAnimationFrame(() => {
    const [c, w, h] = sizeCanvas(cv);
    c.clearRect(0, 0, w, h);
    if (t.preview) drawPreview(c, t.preview, 0, 0, w, h, .95);
    else { c.fillStyle = "#1D2024"; c.fillRect(0, h / 2, w, 1); }
  });
}

function ensureVisible(i) {
  const body = $("#lib-body");
  if (i * ROW < body.scrollTop) body.scrollTop = i * ROW;
  else if ((i + 1) * ROW > body.scrollTop + body.clientHeight) body.scrollTop = (i + 1) * ROW - body.clientHeight;
}

function select(id, play) {
  sel = id;
  paint(true);
  const t = TRACKS.find(x => x.id === id);
  if (t && t.status === "ok") loadDeck(id, play);
}

// ---------------------------------------------------------- Camelot wheel
function drawWheel() {
  const svg = $("#camelot");
  const seg = (r0, r1, a0, a1) => {
    const p = (r, a) => [r * Math.sin(a), -r * Math.cos(a)];
    const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
    return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3}Z`;
  };
  let h = "";
  for (let n = 1; n <= 12; n++) {
    const a0 = ((n - 1) / 12) * 2 * Math.PI - Math.PI / 12, a1 = a0 + 2 * Math.PI / 12;
    const am = (a0 + a1) / 2;
    for (const [l, r0, r1] of [["B", 70, 104], ["A", 40, 70]]) {
      const k = `${n}${l}`;
      const cls = keys.size ? (keys.has(k) ? "sel" : "dim") : "";
      h += `<path d="${seg(r0, r1, a0, a1)}" fill="${keyColor(k)}" class="${cls}" data-k="${k}"><title>${k}</title></path>`;
      const rr = (r0 + r1) / 2;
      h += `<text x="${rr * Math.sin(am)}" y="${-rr * Math.cos(am) + 3.4}" text-anchor="middle">${k}</text>`;
    }
  }
  h += `<text class="ctr" x="0" y="4" text-anchor="middle">KEY</text>`;
  svg.innerHTML = h;
  svg.onclick = e => {
    const k = e.target.dataset?.k; if (!k) return;
    keys.has(k) ? keys.delete(k) : keys.add(k);
    drawWheel(); apply();
  };
}
