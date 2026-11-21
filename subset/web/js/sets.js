// Sets: list, import (Spotify / tracklist), set editor (timeline, transitions, playlist), export
import { $, $$, api, esc, fmt, keyChip, keyColor, energyBars, camelotRelation, setArt, toast, modal, popAt, closeLayer, pickFolder, sizeCanvas, job } from "./util.js";
import { drawWave, PHRASE } from "./wave.js";
import { getFull } from "./deck.js";
import { setSource } from "./transport.js";
import { MixEngine } from "./mixengine.js";
import { TRACKS, refresh as refreshLibrary } from "./library.js";

export const engine = new MixEngine();
let META = { transition_types: {} };
let SET = null, PLAN = null, FULL = {}, SFX = [];
let sets = [];
let pxs = 6, viewT = 0, follow = true;   // timeline zoom (px per second), left edge, auto-follow

const TT_ICON = {
  bass: '<path class="a" d="M2 4h20l20 0" stroke="#F2F2F2" stroke-width="1.6" fill="none"/><path d="M2 18h20V8h20" stroke="#F5A524" stroke-width="1.6" fill="none"/>',
  blend: '<path class="a" d="M2 4C14 4 30 18 42 18" stroke="#F2F2F2" stroke-width="1.6" fill="none"/><path d="M2 18C14 18 30 4 42 4" stroke="#8A9099" stroke-width="1.6" fill="none"/>',
  high_low: '<path class="a" d="M2 5h18c8 0 10 12 22 12" stroke="#F2F2F2" stroke-width="1.6" fill="none"/><path d="M2 19h40" stroke="#5B616B" stroke-width="1" stroke-dasharray="2 3"/>',
  low_high: '<path class="a" d="M2 17h18c8 0 10-12 22-12" stroke="#F2F2F2" stroke-width="1.6" fill="none"/><path d="M2 19h40" stroke="#5B616B" stroke-width="1" stroke-dasharray="2 3"/>',
  echo: '<path class="a" d="M2 5h12v12" stroke="#F2F2F2" stroke-width="1.6" fill="none"/><path d="M18 9v8M24 12v5M30 14v3M36 15.5v1.5" stroke="#8A9099" stroke-width="1.6"/>',
  cut: '<path class="a" d="M2 5h20v13" stroke="#F2F2F2" stroke-width="1.6" fill="none"/><path d="M22 5v13h20" stroke="#8A9099" stroke-width="1.6" fill="none" opacity=".0"/><path d="M22 18h20" stroke="#8A9099" stroke-width="1.6"/>',
};
const ttIcon = (t, w = 44, h = 22) => `<svg viewBox="0 0 44 22" width="${w}" height="${h}">${TT_ICON[t] || ""}</svg>`;

export async function initSets(meta) {
  META = meta;
  engine.onChange = () => paintRows();
  $("#btn-new-set").onclick = () => newSetView();
  $("#set-list").onclick = e => { const b = e.target.closest("[data-set]"); if (b) openSet(+b.dataset.set); };
  window.addEventListener("resize", () => { if (PLAN) drawAll(); });
  (function loop() {
    if (PLAN && engine.isPlaying() && $("#v-sets").classList.contains("on")) {
      const t = engine.time();
      const W = $("#timeline")?.getBoundingClientRect().width || 0;
      if (follow && (t < viewT || t > viewT + W / pxs * 0.85)) viewT = Math.max(0, t - W / pxs * 0.15);
      drawTimeline(); drawMinimap(); drawCurve();
      const cur = engine.currentEntry();
      if (cur && cur.idx !== loop.last) { loop.last = cur.idx; paintRows(); }
    }
    requestAnimationFrame(loop);
  })();
  await loadSetList();
}

export async function loadSetList() {
  sets = await api("/sets");
  $("#set-list").innerHTML = sets.map(s => `<button class="set-item ${SET?.id === s.id ? "on" : ""}" data-set="${s.id}">
      <div class="n">${esc(s.name)}</div><div class="d">${new Date(s.updated * 1000).toLocaleDateString("sr-RS")}</div></button>`).join("")
    || '<div class="hint" style="padding:6px 8px">Nema setova. Napravi prvi iz Spotify plejliste ili tracklistе.</div>';
  if (!SET && !$("#sets-main").children.length && $("#v-sets").classList.contains("on")) sets.length ? openSet(sets[0].id) : newSetView();
}

// ====================================================================== import / new set
let NS = null;
export function newSetView() {
  SET = null; PLAN = null;
  $$(".set-item").forEach(b => b.classList.remove("on"));
  $("#sets-main").innerHTML = `
  <div class="set-head"><span class="set-name" style="border:none">Novi set</span><span class="set-meta">Spotify plejlista ili tracklista → set sa prelazima</span></div>
  <div class="import"><div class="import-grid">
    <div class="card">
      <div class="card-h">Izvor</div>
      <div class="card-b">
        <label class="field"><span>Naziv seta</span><input type="text" id="ns-name" placeholder="npr. Artist X — Novi Sad, 28.11."></label>
        <label class="field"><span>Spotify link ili tracklista</span>
          <textarea id="ns-src" rows="10" placeholder="https://open.spotify.com/playlist/…&#10;&#10;ili jedna pesma po redu:&#10;Izvođač - Naziv&#10;Izvođač - Naziv | remix"></textarea></label>
        <div class="hint">Napomena posle <code>|</code> bira verziju (remix, edit, extended…). Ako se pesma ponovi, druga pojava automatski dobija „remix" — promeniš u tabeli.</div>
        <div style="display:flex;justify-content:flex-end"><button class="btn" id="ns-load">Učitaj listu</button></div>
      </div>
    </div>
    <div class="card" id="ns-card" style="display:none">
      <div class="card-h"><span id="ns-sum"></span><div style="display:flex;gap:6px"><button class="btn" id="ns-folder">Folder sa pesmama koje fale</button><button class="btn" id="ns-re">Upari ponovo</button><button class="btn primary" id="ns-create">Napravi set</button></div></div>
      <div class="table match-table"><div class="thead" id="ns-head"></div><div id="ns-rows"></div></div>
    </div>
  </div></div>`;
  $("#ns-load").onclick = async () => {
    const src = $("#ns-src").value.trim(); if (!src) return toast("Nalepi Spotify link ili tracklistu.");
    $("#ns-load").disabled = true;
    try { NS = await api("/import", { body: { source: src, name: $("#ns-name").value } }); if (!$("#ns-name").value) $("#ns-name").value = NS.name; renderNS(); }
    catch (e) { toast(esc(e.message), { kind: "err", ms: 8000 }); }
    $("#ns-load").disabled = false;
  };
}

const NS_GRID = "36px minmax(200px,1.2fr) 150px minmax(220px,1.4fr) 86px";
function renderNS() {
  $("#ns-card").style.display = "";
  const miss = NS.items.filter(i => !i.track_id).length;
  $("#ns-sum").innerHTML = `${NS.items.length} pesama · ${miss ? `<span style="color:var(--error)">${miss} nije pronađeno</span>` : `<span style="color:var(--success)">sve pronađeno</span>`}`;
  $("#ns-head").style.gridTemplateColumns = NS_GRID;
  $("#ns-head").innerHTML = "<div>#</div><div>Sa liste</div><div>Napomena</div><div>Fajl u biblioteci</div><div>Status</div>";
  const opts = TRACKS.filter(t => t.status === "ok").map(t => `<option value="${t.id}">${esc((t.artist ? t.artist + " – " : "") + t.title)}</option>`).join("");
  $("#ns-rows").innerHTML = NS.items.map((it, i) => `
    <div class="row" data-i="${i}" style="grid-template-columns:${NS_GRID}">
      <div class="num">${i + 1}</div>
      <div><span class="t-title">${esc(it.title)}</span><span class="t-artist">${esc(it.artist)}</span>${it.duplicate ? '<span class="badge dup">ponavlja se</span>' : ""}</div>
      <div><input class="note-in ns-note" value="${esc(it.note)}" placeholder="original"></div>
      <div><select class="ns-pick"><option value="">— nije pronađeno —</option>${opts}</select></div>
      <div>${it.track_id ? `<span class="badge ok">${it.manual ? "ručno" : Math.min(100, Math.round(it.score)) + "%"}</span>` : '<span class="badge miss">fali</span>'}</div>
    </div>`).join("");
  $$("#ns-rows .row").forEach(r => { r.querySelector(".ns-pick").value = NS.items[+r.dataset.i].track_id || ""; });
  $("#ns-rows").onchange = e => {
    const r = e.target.closest(".row"); const it = NS.items[+r.dataset.i];
    if (e.target.classList.contains("ns-note")) it.note = e.target.value;
    if (e.target.classList.contains("ns-pick")) { it.track_id = +e.target.value || null; it.manual = true; renderNS(); }
  };
  $("#ns-re").onclick = rematch;
  $("#ns-folder").onclick = async () => {
    const p = await pickFolder(); if (!p) return;
    const r = await api("/scan", { body: { path: p } });
    toast(`Folder dodat: ${r.found} pesama, ${r.new} na analizi.`);
    await refreshLibrary(); rematch();
  };
  $("#ns-create").onclick = async () => {
    const items = NS.items.filter(i => i.track_id).map(i => ({ track_id: i.track_id, note: i.note, title: i.title, artist: i.artist }));
    if (!items.length) return toast("Nijedna pesma nije povezana sa fajlom.", { kind: "err" });
    const r = await api("/sets", { body: { name: $("#ns-name").value || NS.name || "Novi set", items, source: $("#ns-src").value } });
    await loadSetList(); openSet(r.id);
  };
}
async function rematch() { await refreshLibrary(); NS.items = await api("/match", { body: { items: NS.items } }); renderNS(); }

// ====================================================================== set editor
export async function openSet(id) {
  engine.pause();
  SET = await api("/sets/" + id);
  SFX = await api("/sfx");
  $$(".set-item").forEach(b => b.classList.toggle("on", +b.dataset.set === id));
  viewT = 0; follow = true;
  renderEditor();
  await refreshPlan(true);
}

async function save() { await api("/sets/" + SET.id, { method: "PUT", body: SET }); }

async function refreshPlan(fit = false) {
  PLAN = await api(`/sets/${SET.id}/plan`);
  await Promise.all(PLAN.entries.map(async e => { FULL[e.track_id] = await getFull(e.track_id); }));
  engine.setPlan(PLAN, FULL);
  if ($("#v-sets").classList.contains("on")) setSource(engine);
  if (fit) { const W = $("#timeline").getBoundingClientRect().width; pxs = Math.max(0.6, Math.min(40, (W - 20) / Math.max(60, PLAN.total))); viewT = 0; }
  renderHead();
  paintRows(true);
  drawAll();
}

function renderEditor() {
  $("#sets-main").innerHTML = `
    <div class="set-head" id="set-head"></div>
    <div class="set-opts" id="set-opts"></div>
    <div class="minimap" id="minimap"><canvas id="mm"></canvas></div>
    <div class="timeline"><canvas id="timeline"></canvas></div>
    <div class="curve"><canvas id="curve"></canvas></div>
    <div class="table set-table"><div class="thead" id="st-head"></div><div class="tbody" id="st-rows"></div></div>`;
  bindTimeline();
}

function renderHead() {
  const n = PLAN.entries.length;
  const bpms = PLAN.entries.map(e => e.bpm);
  const st = PLAN.settings;
  $("#set-head").innerHTML = `
    <input class="set-name" id="set-name" value="${esc(SET.name)}" spellcheck="false">
    <div class="set-meta"><span><b>${n}</b>pesama</span><span><b>${fmt(PLAN.total)}</b>trajanje</span>${n ? `<span><b>${Math.min(...bpms).toFixed(0)}–${Math.max(...bpms).toFixed(0)}</b>BPM</span>` : ""}${PLAN.pending ? `<span style="color:var(--warning)">${PLAN.pending} se još analizira</span>` : ""}</div>
    <div class="spacer"></div>
    <button class="btn" id="btn-hz">Harmonize</button>
    <button class="btn" id="btn-more" title="Više">⋯</button>
    <button class="btn primary" id="btn-export">Export</button>`;
  $("#set-opts").innerHTML = `
    <div class="opt">Intro ${seg("intro_mode", { full: "Ceo", short: "Kratak", skip: "Preskoči" }, st.intro_mode)}</div>
    <div class="opt">Outro ${seg("outro_mode", { full: "Ceo", short: "Kratak", skip: "Preskoči" }, st.outro_mode)}</div>
    <div class="opt">Prelaz <select data-s="trans_type">${Object.entries(META.transition_types).map(([k, v]) => `<option value="${k}" ${k === st.trans_type ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    <div class="opt">Dužina ${seg("trans_bars", { auto: "Auto", 4: "4", 8: "8", 16: "16", 32: "32" }, String(st.trans_bars))}</div>
    <div class="opt" style="margin-left:auto">Zoom <div class="seg"><button data-zoom="-1">−</button><button data-zoom="fit">Ceo set</button><button data-zoom="1">+</button></div></div>`;
  $("#set-name").onchange = async e => { SET.name = e.target.value.trim() || SET.name; await save(); loadSetList(); };
  $$("#set-opts [data-s]").forEach(el => {
    const set = async v => { SET.settings = { ...(SET.settings || {}), [el.dataset.s]: v }; SET.transitions = []; await save(); refreshPlan(); };
    if (el.tagName === "SELECT") el.onchange = () => set(el.value);
    else el.onclick = e => { const b = e.target.closest("button"); if (b) set(b.dataset.v); };
  });
  $$("#set-opts [data-zoom]").forEach(b => b.onclick = () => {
    const W = $("#timeline").getBoundingClientRect().width;
    if (b.dataset.zoom === "fit") { pxs = (W - 20) / Math.max(60, PLAN.total); viewT = 0; }
    else zoomAt(b.dataset.zoom > 0 ? 1.5 : 1 / 1.5, W / 2);
    drawAll();
  });
  $("#btn-hz").onclick = e => {
    const r = e.target.getBoundingClientRect();
    const m = popAt(`
      <button data-m="fuzzy" data-d="any"><b>Fuzzy</b><span>Samo bliski key-evi — za live setove</span></button>
      <button data-m="mood" data-d="any"><b>Mood</b><span>Dozvoljava energy boost skokove (+2, +7)</span></button>
      <hr>
      <button data-m="fuzzy" data-d="asc"><b>Fuzzy · tempo raste</b><span>Od sporijih ka bržim</span></button>
      <button data-m="fuzzy" data-d="desc"><b>Fuzzy · tempo opada</b><span>Od bržih ka sporijim</span></button>
      <hr>
      <button data-m="fuzzy" data-d="any" data-pin="1"><b>Zadrži prvu pesmu</b><span>Prva ostaje prva, ostalo se slaže</span></button>`, r.left, r.bottom + 6, 240, "menu");
    m.onclick = async ev => {
      const b = ev.target.closest("button"); if (!b) return;
      closeLayer();
      SET = await api(`/sets/${SET.id}/harmonize`, { body: { mode: b.dataset.m, direction: b.dataset.d, pin_first: !!b.dataset.pin } });
      toast("Redosled složen po key-u, tempu i energiji.", { kind: "ok", actions: [] });
      refreshPlan();
    };
  };
  $("#btn-more").onclick = e => {
    const r = e.target.getBoundingClientRect();
    const m = popAt(`<button data-a="dup"><b>Dupliraj set</b><span>Kopija za drugu verziju</span></button><hr><button data-a="del"><b style="color:var(--error)">Obriši set</b><span>Pesme ostaju u biblioteci</span></button>`, r.right - 230, r.bottom + 6, 230, "menu");
    m.onclick = async ev => {
      const b = ev.target.closest("button"); if (!b) return; closeLayer();
      if (b.dataset.a === "del") {
        if (!confirm(`Obrisati set „${SET.name}"?`)) return;
        engine.pause(); await api("/sets/" + SET.id, { method: "DELETE" }); SET = null; PLAN = null; $("#sets-main").innerHTML = ""; await loadSetList();
      } else {
        const { id, ...copy } = SET; const r2 = await api("/sets", { body: { ...copy, name: SET.name + " (kopija)" } }); await loadSetList(); openSet(r2.id);
      }
    };
  };
  $("#btn-export").onclick = exportDialog;
}
const seg = (k, opts, cur) => `<div class="seg" data-s="${k}">${Object.entries(opts).map(([v, l]) => `<button data-v="${v}" class="${String(cur) === v ? "on" : ""}">${l}</button>`).join("")}</div>`;

// ---------------------------------------------------------------------- playlist table
const ST_COLS = [["", "26px"], ["#", "30px"], ["Start", "60px"], ["", "34px"], ["Naziv", "minmax(150px,1.4fr)"], ["Izvođač", "minmax(110px,1fr)"], ["Prelaz u pesmu", "168px"],
  ["Key", "58px"], ["", "30px"], ["Energ.", "58px"], ["BPM", "60px"], ["Δ", "54px"], ["Napomena", "minmax(90px,.8fr)"], ["", "34px"]];
const ST_GRID = ST_COLS.map(c => c[1]).join(" ");

function paintRows(force = false) {
  if (!PLAN || !$("#st-rows")) return;
  const head = $("#st-head");
  if (!head.innerHTML || force) {
    head.style.gridTemplateColumns = ST_GRID;
    head.innerHTML = ST_COLS.map(([l], i) => `<div class="${i === 10 || i === 11 || i === 2 ? "r" : ""}" style="cursor:default">${l}</div>`).join("");
  }
  const cur = engine.isPlaying() ? engine.currentEntry()?.idx : -1;
  if (!force && paintRows.lastCur === cur && $("#st-rows").children.length === PLAN.entries.length) return;
  paintRows.lastCur = cur;
  $("#st-rows").innerHTML = PLAN.entries.map((e, i) => {
    const tr = PLAN.transitions[i - 1];
    const prev = PLAN.entries[i - 1];
    const rel = prev ? camelotRelation(prev.camelot, e.camelot) : null;
    const dpct = prev ? (e.bpm / prev.bpm - 1) * 100 : 0;
    const dcls = Math.abs(dpct) > 8 ? "bad" : Math.abs(dpct) > 4 ? "warn" : "";
    const trCell = tr ? `<span class="tcell" data-tr="${i - 1}" title="${esc(META.transition_types[tr.type] || tr.type)}${tr.warn ? " — " + esc(tr.warn) : ""}">${ttIcon(tr.type, 26, 13)}${esc(META.transition_types[tr.type] || tr.type)}<span class="bars">${tr.eff_bars ? tr.bars : ""}</span>${tr.warn ? '<span style="color:var(--warning)">!</span>' : ""}${tr.sfx ? '<span style="color:var(--accent)">♪</span>' : ""}</span>` : '<span style="color:var(--faint);font-size:11px">početak</span>';
    return `<div class="row ${cur === i ? "playing" : ""}" data-i="${i}" draggable="true" style="grid-template-columns:${ST_GRID}">
      <div class="handle" title="Prevuci">⋮⋮</div>
      <div class="num">${i + 1}</div>
      <div class="r num" data-seek="${e.t_start}" style="cursor:pointer">${fmt(e.t_start)}</div>
      <div style="padding:0 4px"><span class="art xs" data-art="${e.track_id}"></span></div>
      <div><span class="t-title">${esc(e.title)}</span></div>
      <div><span class="t-artist">${esc(e.artist || "")}</span></div>
      <div>${trCell}</div>
      <div>${keyChip(e.camelot)}</div>
      <div>${rel ? `<span class="mood ${rel.level}" title="${esc(rel.label)}">${rel.icon}</span>` : ""}</div>
      <div>${energyBars(e.energy)}</div>
      <div class="r num">${e.bpm.toFixed(1)}</div>
      <div class="r"><span class="delta ${dcls}">${prev ? (dpct >= 0 ? "+" : "") + dpct.toFixed(1) + "%" : ""}</span></div>
      <div><input class="note-in" data-note="${i}" value="${esc(e.note || "")}" placeholder="—"></div>
      <div><button class="icon-btn rm" data-rm="${i}" title="Ukloni iz seta"><svg viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5"/></svg></button></div>
    </div>`;
  }).join("");
  $$("#st-rows [data-art]").forEach(el => setArt(el, +el.dataset.art));
  bindRows();
}

function bindRows() {
  const rows = $("#st-rows");
  rows.onclick = async e => {
    const tr = e.target.closest("[data-tr]");
    if (tr) { const r = tr.getBoundingClientRect(); return transitionPop(+tr.dataset.tr, r.left, r.bottom + 6); }
    const s = e.target.closest("[data-seek]");
    if (s) { engine.seek(+s.dataset.seek); setSource(engine); return; }
    const rm = e.target.closest("[data-rm]");
    if (rm) { SET.items.splice(+rm.dataset.rm, 1); SET.transitions = []; await save(); refreshPlan(); return; }
  };
  rows.ondblclick = e => { const r = e.target.closest(".row"); if (!r || e.target.closest("input,button,.tcell")) return; setSource(engine); engine.play(PLAN.entries[+r.dataset.i].t_start); };
  rows.onchange = async e => { if (e.target.dataset.note !== undefined) { SET.items[+e.target.dataset.note].note = e.target.value; await save(); } };
  let from = null;
  rows.ondragstart = e => { const r = e.target.closest(".row"); from = +r.dataset.i; e.dataTransfer.effectAllowed = "move"; };
  rows.ondragover = e => { e.preventDefault(); $$("#st-rows .row").forEach(r => r.classList.remove("drag-over")); e.target.closest(".row")?.classList.add("drag-over"); };
  rows.ondragleave = () => $$("#st-rows .row").forEach(r => r.classList.remove("drag-over"));
  rows.ondrop = async e => {
    e.preventDefault();
    const r = e.target.closest(".row"); if (!r || from === null) return;
    const to = +r.dataset.i; if (to === from) return;
    const [it] = SET.items.splice(from, 1); SET.items.splice(to, 0, it);
    SET.transitions = []; from = null; await save(); refreshPlan();
  };
}

// ---------------------------------------------------------------------- transition popover
function transitionPop(i, x, y) {
  const tr = PLAN.transitions[i], a = PLAN.entries[i], b = PLAN.entries[i + 1];
  const rel = camelotRelation(a.camelot, b.camelot);
  const types = Object.entries(META.transition_types);
  const p = popAt(`
    <div class="pop-h"><div><div class="t">Prelaz ${i + 1} → ${i + 2}</div><div class="s">${esc(a.title)} → ${esc(b.title)}</div></div>
      <div style="display:flex;gap:6px;align-items:center">${keyChip(a.camelot)}<span style="color:var(--faint)">→</span>${keyChip(b.camelot)}</div></div>
    <div class="pop-b">
      <div class="presets">${types.map(([k, v]) => `<button class="preset ${tr.type === k ? "on" : ""}" data-type="${k}">${ttIcon(k)}${v}</button>`).join("")}</div>
      <div class="pop-row">Dužina <div class="seg accent" id="pop-bars">${[1, 2, 4, 8, 16, 32].map(n => `<button data-b="${n}" class="${tr.bars == n ? "on" : ""}">${n}</button>`).join("")}</div></div>
      <div class="pop-row">SFX <select id="pop-sfx"><option value="">bez efekta</option>${SFX.map(f => `<option ${f === tr.sfx ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></div>
      <div class="hint" style="font-size:12px">${rel.label} · tempo ${tr.bpm_diff_pct}%${tr.synced ? " · sinhronizovano" : ""}${SFX.length ? "" : " · SFX folder podesi u Podešavanjima"}</div>
      ${tr.warn ? `<div class="warn">${esc(tr.warn)}</div>` : ""}
    </div>
    <div class="pop-f"><button class="btn" id="pop-all">Primeni na sve prelaze</button><button class="btn primary" id="pop-listen">Preslušaj</button></div>`, x, y);
  const setT = async patch => {
    SET.transitions = SET.transitions || [];
    while (SET.transitions.length <= i) SET.transitions.push({});
    SET.transitions[i] = { ...(SET.transitions[i] || {}), ...patch };
    await save(); await refreshPlan();
    transitionPop(i, x, y);
  };
  p.querySelector(".presets").onclick = e => { const b = e.target.closest("[data-type]"); if (b) setT({ type: b.dataset.type }); };
  $("#pop-bars", p).onclick = e => { const b = e.target.closest("[data-b]"); if (b) setT({ bars: +b.dataset.b }); };
  $("#pop-sfx", p).onchange = e => setT({ sfx: e.target.value || null });
  $("#pop-listen", p).onclick = () => { setSource(engine); const bar = 240 / a.bpm; engine.play(Math.max(0, tr.t_start - 8 * bar)); };
  $("#pop-all", p).onclick = async () => {
    SET.transitions = PLAN.transitions.map(() => ({ type: tr.type, bars: tr.bars }));
    await save(); await refreshPlan(); closeLayer(); toast(`Svi prelazi: ${META.transition_types[tr.type]}, ${tr.bars} taktova`, { kind: "ok" });
  };
}

// ---------------------------------------------------------------------- timeline / minimap / curve
const LANE_TOP = 22, LANE_H = 116, LANE_GAP = 6;
function drawAll() { drawTimeline(); drawMinimap(); drawCurve(); }

function zoomAt(f, x) {
  const t = viewT + x / pxs;
  pxs = Math.max(0.4, Math.min(60, pxs * f));
  viewT = Math.max(0, t - x / pxs);
}

function bindTimeline() {
  const tl = $("#timeline"), mm = $("#mm");
  tl.addEventListener("wheel", e => {
    e.preventDefault();
    const x = e.offsetX;
    if (e.ctrlKey || e.metaKey) zoomAt(e.deltaY > 0 ? 1 / 1.15 : 1.15, x);
    else { viewT = Math.max(0, viewT + (e.deltaX || e.deltaY) / pxs * 0.8); follow = false; }
    drawAll();
  }, { passive: false });
  let drag = null;
  tl.addEventListener("mousedown", e => { drag = { x: e.clientX, v: viewT, moved: false }; });
  window.addEventListener("mousemove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 3) { drag.moved = true; follow = false; viewT = Math.max(0, drag.v - dx / pxs); drawAll(); }
  });
  window.addEventListener("mouseup", e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved || !PLAN) return;
    const r = tl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const t = viewT + x / pxs;
    const tr = PLAN.transitions.find(q => t >= q.t_start - 4 / pxs && t <= Math.max(q.t_end, q.t_start + 6 / pxs) && y > LANE_TOP);
    if (tr) return transitionPop(tr.idx, e.clientX + 8, e.clientY + 8);
    follow = true; setSource(engine); engine.seek(t);
  });
  mm.addEventListener("mousedown", e => {
    const move = ev => {
      const r = mm.getBoundingClientRect(); const W = $("#timeline").getBoundingClientRect().width;
      viewT = Math.max(0, (ev.clientX - r.left) / r.width * PLAN.total - W / pxs / 2); follow = false; drawAll();
    };
    move(e);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  });
}

function drawTimeline() {
  const cv = $("#timeline"); if (!cv || !PLAN) return;
  const [c, W, H] = sizeCanvas(cv);
  c.fillStyle = "#08090A"; c.fillRect(0, 0, W, H);
  const X = t => (t - viewT) * pxs, t1 = viewT + W / pxs;
  // ruler
  const step = [5, 10, 15, 30, 60, 120, 300].find(s => s * pxs >= 70) || 600;
  c.font = "500 10px 'Plex Mono'"; c.fillStyle = "#5B616B";
  for (let s = Math.floor(viewT / step) * step; s < t1; s += step) {
    const x = Math.round(X(s)) + .5;
    c.fillStyle = "#24282E"; c.fillRect(x, 14, 1, H - 14);
    c.fillStyle = "#5B616B"; c.fillText(fmt(s), x + 4, 11);
  }
  c.fillStyle = "#24282E"; c.fillRect(0, LANE_TOP - 4, W, 1);
  // blocks
  PLAN.entries.forEach((e, i) => {
    if (e.t_end < viewT || e.t_start > t1) return;
    const y = LANE_TOP + (i % 2) * (LANE_H + LANE_GAP), x0 = X(e.t_start), x1 = X(e.t_end), w = x1 - x0;
    const t = FULL[e.track_id], cam = e.camelot;
    c.fillStyle = "#121417"; c.fillRect(x0, y, w, LANE_H);
    if (t?.analysis) {
      const a = t.analysis;
      // map timeline -> source roughly linearly for drawing
      const srcSpan = e.end_src - e.in_src;
      const vs = Math.max(e.t_start, viewT), ve = Math.min(e.t_end, t1);
      const s0 = e.in_src + (vs - e.t_start) / (e.t_end - e.t_start) * srcSpan, s1 = e.in_src + (ve - e.t_start) / (e.t_end - e.t_start) * srcSpan;
      drawWave(c, a.waveform, s0, s1, X(vs), y + 17, X(ve) - X(vs), LANE_H - 23);
      for (const p of a.phrases) {
        const ps = p.start, pe = p.start + p.bars * 240 / a.bpm;
        const ta = e.t_start + (ps - e.in_src) / srcSpan * (e.t_end - e.t_start), tb = e.t_start + (pe - e.in_src) / srcSpan * (e.t_end - e.t_start);
        if (tb < e.t_start || ta > e.t_end) continue;
        const xa = Math.max(x0, X(ta)), xb = Math.min(x1, X(tb));
        c.fillStyle = PHRASE[p.label]; c.fillRect(xa, y + LANE_H - 4, Math.max(0, xb - xa - 1), 3);
      }
    }
    // header
    c.fillStyle = "#1A1D21"; c.fillRect(x0, y, w, 16);
    c.save(); c.beginPath(); c.rect(x0, y, w, 16); c.clip();
    c.fillStyle = keyColor(cam); c.font = "500 10px 'Plex Mono'"; c.fillText(cam || "", x0 + 6, y + 11.5);
    c.fillStyle = "#E8EAED"; c.font = "700 11px Satoshi"; c.fillText(`${i + 1}  ${e.title || ""}`, x0 + 36, y + 12);
    const tw = c.measureText(`${i + 1}  ${e.title || ""}`).width;
    c.fillStyle = "#8A9099"; c.font = "500 11px Satoshi"; c.fillText(`${e.artist || ""} · ${e.bpm.toFixed(0)} BPM`, x0 + 44 + tw, y + 12);
    c.restore();
    c.strokeStyle = engine.isPlaying() && engine.currentEntry()?.idx === i ? "rgba(224,79,208,.55)" : "#2A2E34";
    c.lineWidth = 1; c.strokeRect(x0 + .5, y + .5, w - 1, LANE_H - 1);
  });
  // transitions
  for (const tr of PLAN.transitions) {
    const xa = X(tr.t_start), xb = Math.max(X(tr.t_end), xa + 2);
    if (xb < 0 || xa > W) continue;
    const top = LANE_TOP, bot = LANE_TOP + 2 * LANE_H + LANE_GAP;
    const ia = tr.idx, yA = LANE_TOP + (ia % 2) * (LANE_H + LANE_GAP), yB = LANE_TOP + ((ia + 1) % 2) * (LANE_H + LANE_GAP);
    c.fillStyle = "rgba(224,79,208,.07)"; c.fillRect(xa, top, xb - xa, bot - top);
    c.fillStyle = "rgba(224,79,208,.8)"; c.fillRect(Math.round(xa), top, 1, bot - top); c.fillRect(Math.round(xb) - 1, top, 1, bot - top);
    // tab
    c.fillStyle = "#E04FD0"; c.fillRect(xa, LANE_TOP - 4, Math.max(14, xb - xa), 3);
    const w = xb - xa;
    if (w > 6 && ["blend", "bass", "high_low", "low_high"].includes(tr.type)) {
      const curve = (y0, up) => { c.beginPath(); for (let k = 0; k <= 40; k++) { const x = k / 40; const g = tr.type === "bass" ? (up ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2)) : tr.type === "blend" ? (up ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2)) : (up ? Math.sin(x * Math.PI / 2) : (x < .75 ? 1 : Math.cos((x - .75) / .25 * Math.PI / 2))); const px = xa + x * w, py = y0 + 20 + (1 - g) * (LANE_H - 30); k ? c.lineTo(px, py) : c.moveTo(px, py); } c.stroke(); };
      c.strokeStyle = "rgba(242,242,242,.9)"; c.lineWidth = 1.5; curve(yA, false); curve(yB, true);
      if (tr.type === "bass") {
        c.strokeStyle = "#F5A524"; c.lineWidth = 1.5; const xm = xa + w / 2;
        c.beginPath(); c.moveTo(xa, yA + LANE_H - 30); c.lineTo(xm, yA + LANE_H - 30); c.lineTo(xm, yA + LANE_H - 10); c.stroke();
        c.beginPath(); c.moveTo(xa, yB + LANE_H - 10); c.lineTo(xm, yB + LANE_H - 10); c.lineTo(xm, yB + LANE_H - 30); c.lineTo(xb, yB + LANE_H - 30); c.stroke();
      }
    } else if (tr.type === "echo" || tr.type === "cut") {
      c.fillStyle = "#E04FD0"; c.font = "700 9.5px Satoshi"; c.fillText(tr.type === "echo" ? "ECHO" : "CUT", xa + 5, yA + 30);
    }
    if (tr.sfx) { c.fillStyle = "#E04FD0"; c.font = "700 10px Satoshi"; c.fillText("♪ " + tr.sfx.replace(/\.[^.]+$/, ""), xa + 5, bot - 6); }
  }
  // playhead
  const ph = X(engine.time());
  if (ph >= 0 && ph <= W) { c.fillStyle = "#E04FD0"; c.fillRect(Math.round(ph) - 1, 0, 2, H); c.beginPath(); c.moveTo(ph - 5, 0); c.lineTo(ph + 5, 0); c.lineTo(ph, 6); c.fill(); }
}

function drawMinimap() {
  const cv = $("#mm"); if (!cv || !PLAN) return;
  const [c, W, H] = sizeCanvas(cv);
  c.fillStyle = "#08090A"; c.fillRect(0, 0, W, H);
  engine.drawOverview(c, W, H);
  const tlW = $("#timeline").getBoundingClientRect().width;
  const x0 = viewT / PLAN.total * W, x1 = (viewT + tlW / pxs) / PLAN.total * W;
  c.fillStyle = "rgba(255,255,255,.07)"; c.fillRect(x0, 0, x1 - x0, H);
  c.strokeStyle = "rgba(255,255,255,.35)"; c.strokeRect(x0 + .5, .5, Math.max(2, x1 - x0) - 1, H - 1);
  c.fillStyle = "#E04FD0"; c.fillRect(engine.time() / PLAN.total * W, 0, 2, H);
}

function drawCurve() {
  const cv = $("#curve"); if (!cv || !PLAN) return;
  const [c, W, H] = sizeCanvas(cv);
  c.clearRect(0, 0, W, H);
  const X = t => (t - viewT) * pxs;
  const bpms = PLAN.entries.map(e => e.bpm), lo = Math.min(...bpms) - 2, hi = Math.max(...bpms) + 2;
  const Y = b => 8 + (1 - (b - lo) / Math.max(1, hi - lo)) * (H - 16);
  c.font = "700 9.5px Satoshi"; c.fillStyle = "#5B616B"; c.fillText("BPM", 8, 13);
  c.strokeStyle = "#E04FD0"; c.lineWidth = 1.5; c.beginPath();
  PLAN.entries.forEach((e, i) => {
    const xa = X(e.t_start), xb = X(PLAN.entries[i + 1]?.t_start ?? e.t_end);
    i ? c.lineTo(xa, Y(e.bpm)) : c.moveTo(xa, Y(e.bpm));
    c.lineTo(xb, Y(e.bpm));
  });
  c.stroke();
  c.font = "500 10px 'Plex Mono'";
  PLAN.entries.forEach((e, i) => {
    const x = X(e.t_start); if (x < -40 || x > W) return;
    c.fillStyle = "#B4BAC3"; c.fillText(e.bpm.toFixed(0), Math.max(36, x + 4), Y(e.bpm) - 4);
    const tr = PLAN.transitions[i - 1];
    if (tr && tr.bpm_diff_pct > 6) { c.fillStyle = "#F5A524"; c.beginPath(); c.arc(X(tr.t_start), H - 8, 3, 0, 7); c.fill(); }
  });
}

// ---------------------------------------------------------------------- export dialog
function exportDialog() {
  const s = modal(`
  <div class="modal">
    <div class="modal-h">Export — ${esc(SET.name)}<button class="icon-btn" data-x><svg viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5"/></svg></button></div>
    <div class="modal-b">
      <div class="modal-nav">
        <div class="nh">Audio</div><button class="side-item on" data-p="audio"><span>Miks</span></button>
        <div class="nh">DJ softver</div><button class="side-item" data-p="rb"><span>Rekordbox</span></button><button class="side-item" data-p="pl"><span>Plejlista / tracklista</span></button>
        <div class="nh">Produkcija</div><button class="side-item" data-p="daw"><span>FL Studio / Cubase</span></button>
      </div>
      <div class="modal-pane" id="ex-pane"></div>
    </div>
    <div class="modal-f"><button class="btn" data-x>Otkaži</button><button class="btn primary" id="ex-go">Export</button></div>
  </div>`);
  const st = { p: "audio", fmt: "mp3", bits: 24, pl: "m3u8" };
  const pane = () => {
    const P = $("#ex-pane", s);
    $$(".modal-nav [data-p]", s).forEach(b => b.classList.toggle("on", b.dataset.p === st.p));
    if (st.p === "audio") P.innerHTML = `
      <div class="lead">Renderuje ceo set u jedan fajl, sa svim prelazima, tempom i SFX-ovima. Uz fajl ide i tracklista sa vremenima.</div>
      <div class="opt-row"><div class="l"><b>Format</b><span>MP3 320 kbps, WAV ili FLAC</span></div>${seg("fmt", { mp3: "MP3", wav: "WAV", flac: "FLAC" }, st.fmt)}</div>
      ${st.fmt !== "mp3" ? `<div class="opt-row"><div class="l"><b>Bit depth</b><span>24 bit za mastering i arhivu</span></div>${seg("bits", { 16: "16", 24: "24", ...(st.fmt === "wav" ? { 32: "32 float" } : {}) }, String(st.bits))}</div>` : ""}`;
    if (st.p === "rb") P.innerHTML = `
      <div class="lead">Pravi <b>.m3u8</b> plejlistu (najbrži uvoz) i <b>XML</b> sa gridom i obojenim cue-ovima (A zeleno, B žuto, C crveno + memory cue po frazama).</div>
      <div class="opt-row"><div class="l"><b>Samo plejlista</b><span>rekordbox → File → Import → Import Playlist → izaberi .m3u8</span></div></div>
      <div class="opt-row"><div class="l"><b>Sa cue-ovima (XML)</b><span>Preferences → Advanced → Database → rekordbox xml → Imported Library → SubSet_rekordbox.xml, zatim u levom meniju rekordbox xml → desni klik na set → Import Playlist</span></div></div>
      <div class="callout">Rekordbox ne prepisuje cue-ove pesmama koje su već u kolekciji sa svojim cue-ovima. Direktan upis u Rekordbox bazu stiže u sledećoj verziji.</div>`;
    if (st.p === "pl") P.innerHTML = `
      <div class="lead">Plejlista sa putanjama do fajlova ili tracklista sa vremenima za YouTube / Mixcloud opis.</div>
      <div class="opt-row"><div class="l"><b>Format</b><span>M3U8 / M3U za DJ softver, TXT / CSV tracklista</span></div>${seg("pl", { m3u8: "M3U8", m3u: "M3U", txt: "TXT", csv: "CSV" }, st.pl)}</div>`;
    if (st.p === "daw") P.innerHTML = `
      <div class="lead">Jedan FLAC (24 bit) po pesmi, svi počinju od 0:00 sa već ugrađenim prelazima i tempom, plus MIDI fajl sa markerima. Prevučeš sve na takt 1 u FL Studio ili Cubase.</div>`;
    $$(".seg[data-s]", P).forEach(g => g.onclick = e => { const b = e.target.closest("button"); if (!b) return; st[g.dataset.s] = b.dataset.v; if (g.dataset.s === "fmt" && st.fmt === "flac" && st.bits == 32) st.bits = 24; pane(); });
  };
  $$(".modal-nav [data-p]", s).forEach(b => b.onclick = () => { st.p = b.dataset.p; pane(); });
  $$("[data-x]", s).forEach(b => b.onclick = closeLayer);
  $("#ex-go", s).onclick = async () => {
    closeLayer();
    const open = p => api("/open", { body: { path: p } });
    if (st.p === "audio") job(`/sets/${SET.id}/render`, { format: st.fmt, bits: +st.bits }, "Renderujem miks", r => toast(`Miks gotov: <span class="mono">${esc(r.path)}</span>`, { kind: "ok", ms: 9000, actions: [["Otvori folder", () => open(r.path.replace(/[\\/][^\\/]+$/, ""))]] }));
    else if (st.p === "rb") { try { const r = await api(`/sets/${SET.id}/export/rekordbox`, { body: {} }); toast(`Sačuvano: <span class="mono">${esc(r.m3u8)}</span> i XML sa cue-ovima.`, { kind: "ok", ms: 10000, actions: [["Otvori folder", () => open(r.folder)]] }); } catch (e) { toast(esc(e.message), { kind: "err" }); } }
    else if (st.p === "pl") { const r = await api(`/sets/${SET.id}/export/playlist`, { body: { format: st.pl } }); toast(`Sačuvano: <span class="mono">${esc(r.path)}</span>`, { kind: "ok", ms: 8000, actions: [["Otvori folder", () => open(r.folder)]] }); }
    else job(`/sets/${SET.id}/export/daw`, {}, "Pravim DAW fajlove", r => toast("DAW fajlovi su spremni.", { kind: "ok", ms: 9000, actions: [["Otvori folder", () => open(r.path)]] }));
  };
  pane();
}
