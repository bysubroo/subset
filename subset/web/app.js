// SubSet UI
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = async (path, opts = {}) => {
  const o = { method: opts.method || (opts.body ? "POST" : "GET"), headers: {} };
  if (opts.body !== undefined) { o.body = JSON.stringify(opts.body); o.headers["Content-Type"] = "application/json"; }
  const r = await fetch("/api" + path, o);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m } catch {} throw new Error(m); }
  return r.json();
};
const toast = (m, ms = 3500) => { const t = $("#toast"); t.textContent = m; t.style.display = "block"; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = "none", ms); };
const fmt = s => { if (s == null || isNaN(s)) return "-"; s = Math.max(0, s); const m = Math.floor(s / 60); return m + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const keyColor = c => { if (!c) return "#555"; const n = parseInt(c), l = c.slice(-1); return `hsl(${(n * 30 + 60) % 360},70%,${l === "A" ? 58 : 70}%)`; };
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const PH_COLORS = { intro: "#305aff", verse: "#10b176", build: "#e0641b", drop: "#e62828", chorus: "#de44cf", break: "#b432ff", outro: "#305aff" };
const TT_COLORS = { bass: "rgba(29,140,255,.28)", blend: "rgba(40,226,20,.22)", cut: "rgba(230,40,40,.35)", echo: "rgba(195,175,4,.28)" };

let META = {}, TRACKS = [], SEL = null, trackCache = {};
async function getTrack(id) { if (!trackCache[id]) trackCache[id] = await api("/tracks/" + id); return trackCache[id]; }

// ------------------------------------------------------------ navigation
$$("nav button").forEach(b => b.onclick = () => show(b.dataset.view));
function show(v) {
  $$("nav button").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  $$(".view").forEach(s => s.classList.toggle("active", s.id === "v-" + v));
  if (v === "sets") loadSets();
  if (v === "settings") loadSettings();
}

async function pickFolder(defaultPath = "") {
  const r = await api("/pick_folder", { body: {} });
  if (r.path) return r.path;
  return prompt("Upiši putanju foldera (npr. C:\\SubSet\\Muzika):", defaultPath);
}

// ------------------------------------------------------------ status polling
let lastDone = 0;
async function poll() {
  try {
    const s = await api("/status");
    const L = s.library;
    if (s.version && !$(".logo small")) $(".logo").insertAdjacentHTML("beforeend", ` <small class="hint">${s.version}</small>`);
    const busy = L.queued > 0 || L.current;
    $("#status").innerHTML = busy
      ? `Analiza: ${L.done}/${L.total} <span class="bar"><i style="width:${(100 * L.done / Math.max(1, L.total)).toFixed(0)}%"></i></span>`
      : `${TRACKS.length} pesama · spremno`;
    if (busy || L.done !== lastDone) { lastDone = L.done; await loadTracks(false); }
  } catch {}
  setTimeout(poll, 1500);
}

// ------------------------------------------------------------ library
let sortKey = "artist", sortDir = 1;
async function loadTracks(render = true) {
  TRACKS = await api("/tracks");
  renderLib();
}
function renderLib() {
  const q = $("#lib-search").value.toLowerCase();
  const rows = TRACKS.filter(t => !q || `${t.artist} ${t.title} ${t.camelot} ${t.bpm}`.toLowerCase().includes(q))
    .sort((a, b) => ((a[sortKey] ?? "") > (b[sortKey] ?? "") ? 1 : -1) * sortDir);
  $("#lib-count").textContent = `${rows.length} / ${TRACKS.length}`;
  $("#lib-table tbody").innerHTML = rows.map(t => `
    <tr data-id="${t.id}" class="${SEL === t.id ? "sel" : ""}">
      <td>${esc(t.artist)}</td><td>${esc(t.title)}</td>
      <td class="mono">${t.bpm ? t.bpm.toFixed(1) : "-"}</td>
      <td>${t.camelot ? `<span class="key" style="background:${keyColor(t.camelot)}">${t.camelot}</span>` : "-"}</td>
      <td class="mono">${t.energy ?? "-"}</td><td class="mono">${fmt(t.duration)}</td>
      <td>${t.status === "ok" ? '<span class="badge ok">OK</span>' : t.status === "error" ? `<span class="badge err" title="${esc(t.error)}">greška</span>` : '<span class="badge run">' + (t.status === "analyzing" ? "analiza…" : "u redu") + "</span>"}</td>
      <td><button class="small" data-re="${t.id}" title="Ponovo analiziraj">↻</button></td>
    </tr>`).join("");
}
$("#lib-search").oninput = renderLib;
$$("#lib-table th[data-k]").forEach(th => th.onclick = () => { const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : 1; sortKey = k; renderLib(); });
$("#lib-table tbody").onclick = async e => {
  const re = e.target.dataset.re;
  if (re) { await api(`/tracks/${re}/reanalyze`, { body: {} }); delete trackCache[re]; toast("Ponovna analiza…"); return; }
  const tr = e.target.closest("tr"); if (!tr) return;
  SEL = +tr.dataset.id; renderLib(); loadDeck(SEL);
};
$("#btn-add-folder").onclick = async () => {
  const p = await pickFolder(); if (!p) return;
  const r = await api("/scan", { body: { path: p } });
  toast(`Pronađeno ${r.found} pesama, ${r.new} novih za analizu.`);
  loadTracks();
};
$("#btn-rescan").onclick = async () => { const r = await api("/rescan", { body: {} }); toast(`${r.found} pesama, ${r.new} novih/izmenjenih.`); loadTracks(); };

// ------------------------------------------------------------ deck (waveform)
const deck = { t: null, zoom: 12 };
const audioEl = $("#deck-audio");
async function loadDeck(id) {
  const t = await getTrack(id);
  deck.t = t;
  $("#deck-title").textContent = t.title || "";
  $("#deck-sub").textContent = t.artist || "";
  const a = t.analysis;
  $("#deck-bpm").textContent = a ? a.bpm.toFixed(2) : "-";
  $("#deck-key").innerHTML = a ? `<span class="key" style="background:${keyColor(a.camelot)}">${a.camelot}</span> <small>${a.key}</small>` : "-";
  $("#deck-energy").textContent = a ? a.energy : "-";
  $("#deck-time").textContent = fmt(a?.duration);
  $("#deck-cues").innerHTML = (t.cues || []).filter(c => c.type === "hot").map(c =>
    `<button class="cuebtn" style="background:${rgb(c.color)}" data-t="${c.time}" title="${esc(c.name)} ${fmt(c.time)}">${c.slot}</button>`).join("");
  audioEl.src = "/api/audio/" + id;
  audioEl.currentTime = 0;
  $("#deck-play").textContent = "▶";
  drawDeck();
}
$("#deck-cues").onclick = e => { const t = e.target.dataset.t; if (t) { audioEl.currentTime = +t; audioEl.play(); $("#deck-play").textContent = "❚❚"; } };
$("#deck-play").onclick = () => { if (!deck.t) return; if (audioEl.paused) { audioEl.play(); $("#deck-play").textContent = "❚❚"; } else { audioEl.pause(); $("#deck-play").textContent = "▶"; } };
document.addEventListener("keydown", e => { if (e.code === "Space" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && $("#v-library").classList.contains("active")) { e.preventDefault(); $("#deck-play").click(); } });

function sizeCanvas(c) { const r = c.getBoundingClientRect(); const d = devicePixelRatio || 1; c.width = Math.max(1, r.width * d); c.height = r.height * d; const x = c.getContext("2d"); x.setTransform(d, 0, 0, d, 0, 0); return [x, r.width, r.height]; }

// rekordbox-like 3 band waveform
function drawWave(ctx, wf, t0, t1, x0, w, y0, h) {
  if (!wf) return;
  const rate = wf.rate, n = wf.low.length;
  const mid = y0 + h / 2;
  for (let px = 0; px < w; px++) {
    const a = Math.floor((t0 + (t1 - t0) * px / w) * rate), b = Math.max(a + 1, Math.floor((t0 + (t1 - t0) * (px + 1) / w) * rate));
    if (a >= n || b <= 0) continue;
    let L = 0, M = 0, H = 0;
    for (let i = Math.max(0, a); i < Math.min(n, b); i++) { if (wf.low[i] > L) L = wf.low[i]; if (wf.mid[i] > M) M = wf.mid[i]; if (wf.high[i] > H) H = wf.high[i]; }
    const s = h / 2 / 255;
    ctx.fillStyle = "#1f5cff"; ctx.fillRect(x0 + px, mid - L * s, 1, 2 * L * s);
    ctx.fillStyle = "#ff9a1f"; ctx.fillRect(x0 + px, mid - M * s * 0.85, 1, 2 * M * s * 0.85);
    ctx.fillStyle = "#f2f2f2"; ctx.fillRect(x0 + px, mid - H * s * 0.6, 1, 2 * H * s * 0.6);
  }
}

function drawDeck() {
  const t = deck.t; if (!t || !t.analysis) return;
  const a = t.analysis, dur = a.duration, cur = audioEl.currentTime || 0;
  // zoomed
  let [c, W, H] = sizeCanvas($("#deck-wave"));
  c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
  const span = deck.zoom, t0 = cur - span / 2, t1 = cur + span / 2;
  const X = s => (s - t0) / span * W;
  // phrases band
  for (const p of a.phrases) {
    const s = p.start, e = s + p.bars * 240 / a.bpm;
    c.fillStyle = PH_COLORS[p.label] + "33"; c.fillRect(X(s), 0, X(e) - X(s), H);
    c.fillStyle = PH_COLORS[p.label]; c.fillRect(X(s), 0, X(e) - X(s), 4);
    c.fillStyle = "#fff"; c.font = "10px Segoe UI"; c.fillText(p.label.toUpperCase(), X(s) + 4, 15);
  }
  drawWave(c, a.waveform, t0, t1, 0, W, 18, H - 18);
  // beat grid
  for (const b of a.grid.beats) { if (b < t0 || b > t1) continue; c.fillStyle = "rgba(255,255,255,.25)"; c.fillRect(X(b), H - 8, 1, 8); }
  for (const b of a.grid.downbeats) { if (b < t0 || b > t1) continue; c.fillStyle = "rgba(255,60,60,.8)"; c.fillRect(X(b), H - 14, 2, 14); }
  for (const q of t.cues) { const x = X(q.time); if (x < -10 || x > W + 10) continue; c.fillStyle = rgb(q.color);
    if (q.type === "hot") { c.fillRect(x, 18, 2, H - 18); c.fillRect(x, 18, 16, 13); c.fillStyle = "#000"; c.font = "bold 10px Segoe UI"; c.fillText(q.slot, x + 4, 28); }
    else { c.beginPath(); c.moveTo(x - 5, H); c.lineTo(x + 5, H); c.lineTo(x, H - 8); c.fill(); } }
  c.fillStyle = "#fff"; c.fillRect(W / 2, 0, 2, H);
  // overview
  [c, W, H] = sizeCanvas($("#deck-overview"));
  c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
  for (const p of a.phrases) { const s = p.start / dur * W, e = (p.start + p.bars * 240 / a.bpm) / dur * W; c.fillStyle = PH_COLORS[p.label]; c.fillRect(s, H - 4, e - s, 4); }
  drawWave(c, a.waveform, 0, dur, 0, W, 0, H - 5);
  for (const q of t.cues.filter(q => q.type === "hot")) { c.fillStyle = rgb(q.color); c.fillRect(q.time / dur * W, 0, 2, H); }
  c.fillStyle = "rgba(255,255,255,.9)"; c.fillRect(cur / dur * W, 0, 2, H);
}
(function loop() { if (deck.t && !audioEl.paused) drawDeck(); requestAnimationFrame(loop); })();
window.addEventListener("resize", () => { drawDeck(); if (SET) drawTimeline(); });
$("#deck-overview").onclick = e => { if (!deck.t) return; const r = e.target.getBoundingClientRect(); audioEl.currentTime = (e.clientX - r.left) / r.width * deck.t.analysis.duration; drawDeck(); };
$("#deck-wave").onclick = e => { if (!deck.t) return; const r = e.target.getBoundingClientRect(); audioEl.currentTime += ((e.clientX - r.left) / r.width - 0.5) * deck.zoom; drawDeck(); };
$("#deck-wave").onwheel = e => { e.preventDefault(); deck.zoom = Math.min(120, Math.max(3, deck.zoom * (e.deltaY > 0 ? 1.2 : 1 / 1.2))); drawDeck(); };

// ------------------------------------------------------------ new set (import + match)
let NS = null;
$("#ns-load").onclick = async () => {
  const source = $("#ns-source").value.trim(); if (!source) return toast("Nalepi Spotify link ili tracklistu.");
  $("#ns-load").disabled = true;
  try { NS = await api("/import", { body: { source, name: $("#ns-name").value } }); if (!$("#ns-name").value) $("#ns-name").value = NS.name; renderNS(); }
  catch (e) { toast(e.message, 6000); }
  $("#ns-load").disabled = false;
};
function renderNS() {
  $("#ns-match").hidden = false;
  const miss = NS.items.filter(i => !i.track_id).length;
  $("#ns-summary").innerHTML = `${NS.items.length} pesama · <span style="color:${miss ? "#ffb347" : "#5ee06a"}">${miss ? miss + " nije pronađeno" : "sve pronađeno"}</span>`;
  const opts = TRACKS.map(t => `<option value="${t.id}">${esc((t.artist ? t.artist + " - " : "") + t.title)}</option>`).join("");
  $("#ns-table tbody").innerHTML = NS.items.map((it, i) => `
    <tr data-i="${i}">
      <td class="mono">${i + 1}</td>
      <td>${esc(it.artist)} – <b>${esc(it.title)}</b> ${it.duplicate ? '<span class="badge">ponavlja se</span>' : ""}</td>
      <td><input class="ns-note" value="${esc(it.note)}" placeholder="original / remix / edit…" style="width:150px"></td>
      <td><select class="ns-pick" style="max-width:420px"><option value="">— nije pronađeno —</option>${opts}</select></td>
      <td>${it.track_id ? `<span class="badge ok">${it.manual ? "ručno" : Math.round(it.score) + "%"}</span>` : '<span class="badge err">fali</span>'}</td>
    </tr>`).join("");
  $$("#ns-table tbody tr").forEach(tr => { const it = NS.items[+tr.dataset.i]; $(".ns-pick", tr).value = it.track_id || ""; });
}
$("#ns-table").onchange = e => {
  const tr = e.target.closest("tr"); const it = NS.items[+tr.dataset.i];
  if (e.target.classList.contains("ns-note")) it.note = e.target.value;
  if (e.target.classList.contains("ns-pick")) { it.track_id = +e.target.value || null; it.manual = true; renderNS(); }
};
$("#ns-rematch").onclick = async () => { await loadTracks(); NS.items = await api("/match", { body: { items: NS.items } }); renderNS(); };
$("#ns-folder").onclick = async () => {
  const p = await pickFolder(); if (!p) return;
  const r = await api("/scan", { body: { path: p } });
  toast(`Folder dodat: ${r.found} pesama (${r.new} novih). Analiza radi u pozadini.`);
  setTimeout(() => $("#ns-rematch").click(), 800);
};
$("#ns-create").onclick = async () => {
  const name = $("#ns-name").value || NS.name || "Novi set";
  const items = NS.items.filter(i => i.track_id).map(i => ({ track_id: i.track_id, note: i.note, title: i.title, artist: i.artist }));
  if (!items.length) return toast("Nijedna pesma nije povezana sa fajlom.");
  const r = await api("/sets", { body: { name, items, source: $("#ns-source").value } });
  show("sets"); await loadSets(); openSet(r.id);
};

// ------------------------------------------------------------ sets
let SET = null, PLAN = null, SFX = [], tlZoom = 6; // px per second
async function loadSets() {
  const s = await api("/sets");
  $("#set-list").innerHTML = s.map(x => `<div data-id="${x.id}" class="${SET?.id === x.id ? "active" : ""}">${esc(x.name)}</div>`).join("") || '<div class="hint">Još nema setova.</div>';
}
$("#set-list").onclick = e => { const d = e.target.closest("[data-id]"); if (d) openSet(+d.dataset.id); };

async function openSet(id) {
  SET = await api("/sets/" + id);
  SFX = await api("/sfx");
  await loadSets();
  await refreshPlan();
}
async function saveSet() { await api("/sets/" + SET.id, { method: "PUT", body: SET }); }
async function refreshPlan() {
  PLAN = await api(`/sets/${SET.id}/plan`);
  for (const e of PLAN.entries) await getTrack(e.track_id);
  renderSet();
}

function optList(obj, cur) { return Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k == cur ? "selected" : ""}>${v}</option>`).join(""); }

function renderSet() {
  const st = PLAN.settings;
  $("#set-main").innerHTML = `
  <div class="set-head">
    <span class="name">${esc(SET.name)}</span>
    <span class="hint">${PLAN.entries.length} pesama · ${fmt(PLAN.total)}${PLAN.pending ? ` · <span class="warn">${PLAN.pending} se još analizira</span>` : ""}</span>
    <div class="grp">Intro <select data-s="intro_mode">${optList({ full: "ceo", short: "kratak", skip: "preskoči" }, st.intro_mode)}</select></div>
    <div class="grp">Outro <select data-s="outro_mode">${optList({ full: "ceo", short: "kratak", skip: "preskoči" }, st.outro_mode)}</select></div>
    <div class="grp">Prelaz <select data-s="trans_type">${optList(META.transition_types, st.trans_type)}</select></div>
    <div class="grp">Dužina <select data-s="trans_bars">${optList({ auto: "auto", 1: "1 takt", 2: "2", 4: "4", 8: "8", 16: "16", 32: "32", 64: "64" }, st.trans_bars)}</select></div>
    <div class="grp" style="margin-left:auto">
      <select id="hz-mode">${optList({ fuzzy: "Harmonize: Fuzzy (live)", mood: "Harmonize: Mood (studio)" }, "fuzzy")}</select>
      <select id="hz-dir">${optList({ any: "tempo: slobodno", asc: "tempo: rastuće", desc: "tempo: opadajuće" }, "any")}</select>
      <button id="btn-hz">Harmonize</button>
    </div>
  </div>
  <div class="tl-tools">
    <span class="hint">Zoom</span><input type="range" id="tl-zoom" min="1" max="40" value="${tlZoom}">
    <div class="mixplayer"><audio id="mix-audio" controls></audio></div>
    <div style="margin-left:auto" class="row">
      <button id="btn-rb" class="primary">Export u rekordbox</button>
      <button id="btn-mp3">Render MP3</button>
      <button id="btn-wav">Render WAV</button>
      <button id="btn-daw">Export za FL / Cubase</button>
      <button id="btn-del" title="Obriši set">🗑</button>
    </div>
  </div>
  <div class="timeline-wrap"><canvas id="timeline"></canvas></div>
  <div class="set-lists">
    <div><h3>Tracklista</h3><table class="grid" id="set-tracks"><thead><tr><th>#</th><th>Start</th><th>Pesma</th><th>BPM</th><th>Key</th><th>E</th><th>Napomena</th><th></th></tr></thead><tbody></tbody></table></div>
    <div><h3>Prelazi</h3><table class="grid" id="set-trans"><thead><tr><th>#</th><th>Vreme</th><th>Key</th><th>Tempo</th><th>Tip</th><th>Dužina</th><th>SFX</th><th></th></tr></thead><tbody></tbody></table></div>
  </div>`;
  $$(".set-head [data-s]").forEach(s => s.onchange = async () => { SET.settings = { ...(SET.settings || {}), [s.dataset.s]: s.value }; await saveSet(); refreshPlan(); });
  $("#btn-hz").onclick = async () => { SET = await api(`/sets/${SET.id}/harmonize`, { body: { mode: $("#hz-mode").value, direction: $("#hz-dir").value } }); toast("Redosled složen po key-u, tempu i energiji."); refreshPlan(); };
  $("#tl-zoom").oninput = e => { tlZoom = +e.target.value; drawTimeline(); };
  $("#btn-rb").onclick = async () => { try { const r = await api(`/sets/${SET.id}/export/rekordbox`, { body: {} }); toast(`Sačuvano: ${r.m3u8} (lista) i ${r.path} (sa cue-ovima). Najbrže: rekordbox → File → Import → Import Playlist → izaberi .m3u8.`, 12000); api("/open", { body: { path: r.folder } }); } catch (e) { toast(e.message); } };
  $("#btn-mp3").onclick = () => job(`/sets/${SET.id}/render`, { format: "mp3" }, r => { $("#mix-audio").src = "/api/output?path=" + encodeURIComponent(r.path); toast("Miks gotov: " + r.path, 8000); api("/open", { body: { path: r.path } }); });
  $("#btn-wav").onclick = () => job(`/sets/${SET.id}/render`, { format: "wav" }, r => { $("#mix-audio").src = "/api/output?path=" + encodeURIComponent(r.path); toast("Miks gotov: " + r.path, 8000); api("/open", { body: { path: r.path } }); });
  $("#btn-daw").onclick = () => job(`/sets/${SET.id}/export/daw`, {}, r => { toast("DAW fajlovi: " + r.path + " – prevuci sve na takt 1.", 9000); api("/open", { body: { path: r.path } }); });
  $("#btn-del").onclick = async () => { if (!confirm("Obriši set " + SET.name + "?")) return; await api("/sets/" + SET.id, { method: "DELETE" }); SET = null; $("#set-main").innerHTML = '<div class="empty">Set obrisan.</div>'; loadSets(); };

  // tracklist
  $("#set-tracks tbody").innerHTML = PLAN.entries.map((e, i) => `
    <tr><td class="mono">${i + 1}</td><td class="mono">${fmt(e.t_start)}</td>
    <td>${esc(e.artist)} – <b>${esc(e.title)}</b></td><td class="mono">${e.bpm.toFixed(1)}</td>
    <td><span class="key" style="background:${keyColor(e.camelot)}">${e.camelot}</span></td><td class="mono">${e.energy}</td>
    <td><input class="it-note" data-i="${i}" value="${esc(SET.items[i]?.note || "")}" style="width:90px"></td>
    <td><button class="small" data-up="${i}">↑</button><button class="small" data-down="${i}">↓</button><button class="small" data-rm="${i}">✕</button></td></tr>`).join("");
  $("#set-tracks").onclick = async ev => {
    const d = ev.target.dataset; let i;
    if (d.up !== undefined && (i = +d.up) > 0) [SET.items[i - 1], SET.items[i]] = [SET.items[i], SET.items[i - 1]];
    else if (d.down !== undefined && (i = +d.down) < SET.items.length - 1) [SET.items[i + 1], SET.items[i]] = [SET.items[i], SET.items[i + 1]];
    else if (d.rm !== undefined) SET.items.splice(+d.rm, 1);
    else return;
    SET.transitions = []; await saveSet(); refreshPlan();
  };
  $("#set-tracks").onchange = async ev => { if (ev.target.classList.contains("it-note")) { SET.items[+ev.target.dataset.i].note = ev.target.value; await saveSet(); } };

  // transitions
  const sfxOpts = cur => `<option value="">—</option>` + SFX.map(f => `<option ${f === cur ? "selected" : ""}>${esc(f)}</option>`).join("");
  $("#set-trans tbody").innerHTML = PLAN.transitions.map((t, i) => `
    <tr><td class="mono">${i + 1}→${i + 2}</td><td class="mono">${fmt(t.t_start)}</td>
    <td><span class="dot ${t.key_match}"></span></td>
    <td class="mono ${t.bpm_diff_pct > 6 ? "warn" : ""}">${t.bpm_diff_pct}%${t.synced ? " ⇄" : ""}</td>
    <td><select data-t="${i}" data-f="type">${optList(META.transition_types, t.type)}</select>${t.warn ? ` <span class="warn" title="${esc(t.warn)}">⚠</span>` : ""}</td>
    <td><select data-t="${i}" data-f="bars">${optList({ 1: "1", 2: "2", 4: "4", 8: "8", 16: "16", 32: "32", 64: "64" }, t.bars)}</select></td>
    <td><select data-t="${i}" data-f="sfx">${sfxOpts(t.sfx)}</select></td>
    <td><button class="small" data-prev="${i}">▶ Preslušaj</button></td></tr>`).join("");
  $("#set-trans").onchange = async ev => {
    const i = ev.target.dataset.t; if (i === undefined) return;
    SET.transitions = SET.transitions || [];
    while (SET.transitions.length <= i) SET.transitions.push({});
    SET.transitions[i] = { ...(SET.transitions[i] || {}), [ev.target.dataset.f]: ev.target.value || null };
    await saveSet(); refreshPlan();
  };
  $("#set-trans").onclick = async ev => {
    const i = ev.target.dataset.prev; if (i === undefined) return;
    ev.target.textContent = "…"; ev.target.disabled = true;
    try { const r = await api(`/sets/${SET.id}/preview/${i}`, { body: {} }); const a = $("#mix-audio"); a.src = r.url; a.play(); }
    catch (e) { toast(e.message); }
    ev.target.textContent = "▶ Preslušaj"; ev.target.disabled = false;
  };
  $("#mix-audio").ontimeupdate = drawTimeline;
  drawTimeline();
}

async function job(path, body, done) {
  const { job: id } = await api(path, { body });
  toast("Radim…", 100000);
  const tick = async () => {
    const j = await api("/jobs/" + id);
    if (j.status === "running") { toast(`Radim… ${(j.progress * 100).toFixed(0)}% ${j.msg || ""}`, 100000); setTimeout(tick, 800); }
    else if (j.status === "error") toast("Greška: " + j.msg, 10000);
    else { toast("Gotovo"); done(j.result); }
  };
  tick();
}

function drawTimeline() {
  const cv = $("#timeline"); if (!cv || !PLAN) return;
  const W = Math.max(cv.parentElement.clientWidth, (PLAN.total + 10) * tlZoom), H = 190;
  cv.style.width = W + "px"; cv.style.height = H + "px";
  const d = devicePixelRatio || 1; cv.width = W * d; cv.height = H * d;
  const c = cv.getContext("2d"); c.setTransform(d, 0, 0, d, 0, 0);
  c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
  const X = s => s * tlZoom + 4;
  // ruler
  c.fillStyle = "#666"; c.font = "10px Segoe UI";
  const step = tlZoom > 12 ? 15 : tlZoom > 4 ? 30 : 60;
  for (let s = 0; s < PLAN.total + 10; s += step) { c.fillRect(X(s), 0, 1, 6); c.fillText(fmt(s), X(s) + 2, 14); }
  // transitions
  for (const t of PLAN.transitions) {
    const x0 = X(t.t_start), x1 = Math.max(X(t.t_end), x0 + 3);
    c.fillStyle = TT_COLORS[t.type] || "rgba(255,255,255,.2)"; c.fillRect(x0, 18, x1 - x0, H - 18);
  }
  const laneH = 80;
  PLAN.entries.forEach((e, i) => {
    const y = 22 + (i % 2) * (laneH + 4), x0 = X(e.t_start), x1 = X(e.t_end);
    c.fillStyle = "#15171c"; c.fillRect(x0, y, x1 - x0, laneH);
    const t = trackCache[e.track_id];
    if (t?.analysis) {
      drawWave(c, t.analysis.waveform, e.in_src, e.in_src + (e.t_end - e.t_start), x0, Math.max(1, x1 - x0), y + 14, laneH - 22);
      for (const p of t.analysis.phrases) {
        const ps = Math.max(p.start, e.in_src), pe = p.start + p.bars * 240 / t.analysis.bpm;
        if (pe <= e.in_src) continue;
        const a = x0 + (ps - e.in_src) * tlZoom, b = Math.min(x1, x0 + (pe - e.in_src) * tlZoom);
        c.fillStyle = PH_COLORS[p.label]; c.fillRect(a, y + laneH - 5, Math.max(0, b - a - 1), 5);
      }
    }
    c.fillStyle = "#fff"; c.font = "11px Segoe UI";
    c.save(); c.beginPath(); c.rect(x0, y, x1 - x0, 14); c.clip();
    c.fillText(`${i + 1}. ${e.artist || ""} – ${e.title || ""}  ·  ${e.bpm.toFixed(0)} · ${e.camelot}`, x0 + 4, y + 11); c.restore();
    c.strokeStyle = "#2c2e34"; c.strokeRect(x0 + .5, y + .5, x1 - x0 - 1, laneH - 1);
  });
  // playhead for mix audio
  const a = $("#mix-audio");
  if (a && a.src && a.src.includes("/api/output") && !isNaN(a.currentTime)) { c.fillStyle = "#fff"; c.fillRect(X(a.currentTime), 0, 2, H); }
}

// ------------------------------------------------------------ settings
async function loadSettings() {
  const s = await api("/settings");
  $("#st-export").value = s.export_dir || ""; $("#st-sfx").value = s.sfx_dir || "";
  $("#st-template").innerHTML = optList(META.templates, s.cue_template);
  $("#st-xmlpath").textContent = (s.export_dir || "") + (s.export_dir?.includes("\\") ? "\\" : "/") + "SubSet_rekordbox.xml";
  const st = await api("/status");
  $("#st-engine").textContent = st.library.engine ? "Beat engine: " + st.library.engine : "";
}
$$("[data-pick]").forEach(b => b.onclick = async () => { const p = await pickFolder($("#" + b.dataset.pick).value); if (p) $("#" + b.dataset.pick).value = p; });
$("#st-save").onclick = async () => {
  await api("/settings", { method: "PUT", body: { export_dir: $("#st-export").value, sfx_dir: $("#st-sfx").value, cue_template: $("#st-template").value } });
  toast("Sačuvano. Novi cue šablon važi za pesme koje se od sada analiziraju (↻ za postojeće).");
  loadSettings();
};

// ------------------------------------------------------------ init
(async () => { META = await api("/meta"); await loadTracks(); poll(); })();
