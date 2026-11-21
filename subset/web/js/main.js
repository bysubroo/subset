// SubSet entry
import { $, $$, api, esc, modal, closeLayer, toast, pickFolder } from "./util.js";
import { initTransport, toggle } from "./transport.js";
import { initDeck, invalidate } from "./deck.js";
import { initLibrary, refresh, setFolders, TRACKS } from "./library.js";
import { initSets, loadSetList } from "./sets.js";

let META = {};

function show(v) {
  $$(".nav button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  $$(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  if (v === "sets") loadSetList();
  window.dispatchEvent(new Event("resize"));
}

let lastDone = -1, lastQueued = -1;
async function poll() {
  try {
    const s = await api("/status");
    if (!$("#ver").textContent) $("#ver").textContent = "v" + s.version;
    setFolders(s.folders || []);
    const L = s.library, busy = L.queued > 0 || L.current;
    $("#analysis").hidden = !busy;
    if (busy) {
      $("#analysis-text").textContent = `Analiza ${L.done + 1}/${L.total}`;
      $("#analysis-bar").style.width = (100 * L.done / Math.max(1, L.total)).toFixed(0) + "%";
    }
    if (L.done !== lastDone || L.queued !== lastQueued) {
      if (L.current) invalidate(L.current);
      lastDone = L.done; lastQueued = L.queued;
      await refresh();
    }
  } catch {}
  setTimeout(poll, 1500);
}

async function settingsDialog() {
  const s = await api("/settings");
  const st = await api("/status");
  const m = modal(`
  <div class="modal" style="width:620px">
    <div class="modal-h">Podešavanja<button class="icon-btn" data-x><svg viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5"/></svg></button></div>
    <div class="modal-pane" style="padding:18px 20px">
      <label class="field"><span>Folder za export</span><div style="display:flex;gap:6px"><input type="text" id="st-export" value="${esc(s.export_dir)}" style="flex:1"><button class="btn" data-pick="st-export">Izaberi</button></div></label>
      <label class="field"><span>SFX folder (sirene, efekti između pesama)</span><div style="display:flex;gap:6px"><input type="text" id="st-sfx" value="${esc(s.sfx_dir || "")}" style="flex:1"><button class="btn" data-pick="st-sfx">Izaberi</button></div></label>
      <div class="field"><span>Cue šablon</span>
        <div class="seg" id="st-tpl">${Object.entries(META.templates).map(([k, v]) => `<button data-v="${k}" class="${k === s.cue_template ? "on" : ""}">${esc(v)}</button>`).join("")}</div>
        <div class="hint">Standard: A zeleno = mix in · B žuto = prvi drop/refren · C crveno = mix out + memory cue na svakoj frazi. Klub dodaje D (drugi drop) i E (break). Važi za nove analize — postojeće pesme: ↻ na pesmi.</div>
      </div>
      <div class="hint">Beat engine: <b style="color:var(--text)">${esc(st.library.engine || "učitava se pri prvoj analizi")}</b></div>
    </div>
    <div class="modal-f"><button class="btn" data-x>Otkaži</button><button class="btn primary" id="st-save">Sačuvaj</button></div>
  </div>`);
  let tpl = s.cue_template;
  $("#st-tpl", m).onclick = e => { const b = e.target.closest("button"); if (!b) return; tpl = b.dataset.v; $$("#st-tpl button", m).forEach(x => x.classList.toggle("on", x === b)); };
  $$("[data-pick]", m).forEach(b => b.onclick = async () => { const p = await pickFolder($("#" + b.dataset.pick, m).value); if (p) $("#" + b.dataset.pick, m).value = p; });
  $$("[data-x]", m).forEach(b => b.onclick = closeLayer);
  $("#st-save", m).onclick = async () => {
    await api("/settings", { method: "PUT", body: { export_dir: $("#st-export", m).value, sfx_dir: $("#st-sfx", m).value, cue_template: tpl } });
    closeLayer(); toast("Podešavanja sačuvana.", { kind: "ok" });
  };
}

(async () => {
  await document.fonts.ready;
  META = await api("/meta");
  initTransport();
  initDeck();
  initLibrary();
  await refresh();
  await initSets(META);
  $$(".nav button").forEach(b => b.onclick = () => show(b.dataset.view));
  $("#btn-settings").onclick = settingsDialog;
  document.addEventListener("keydown", e => {
    if (e.code === "Space" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { e.preventDefault(); toggle(); }
  });
  poll();
})();
