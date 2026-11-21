// Shared helpers
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export async function api(path, opts = {}) {
  const o = { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers: {} };
  if (opts.body !== undefined) { o.body = JSON.stringify(opts.body); o.headers["Content-Type"] = "application/json"; }
  const r = await fetch("/api" + path, o);
  if (!r.ok) {
    let m = r.statusText;
    try { m = (await r.json()).detail || m; } catch {}
    throw new Error(m);
  }
  return r.status === 204 ? null : r.json();
}

export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function fmt(s) {
  if (s == null || isNaN(s)) return "–";
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}

// Camelot colours (pastel wheel, readable on graphite)
const HUES = { 1: 172, 2: 158, 3: 140, 4: 96, 5: 52, 6: 34, 7: 16, 8: 352, 9: 318, 10: 284, 11: 248, 12: 204 };
export function keyColor(cam) {
  if (!cam) return "#5B616B";
  const n = parseInt(cam), l = cam.slice(-1).toUpperCase();
  return `hsl(${HUES[n] ?? 0} ${l === "A" ? 62 : 70}% ${l === "A" ? 66 : 74}%)`;
}
export const keyChip = cam => cam ? `<span class="key" style="color:${keyColor(cam)}">${esc(cam)}</span>` : `<span class="key" style="color:#5B616B">–</span>`;
export function energyBars(e) {
  if (!e) return "";
  let h = '<span class="energy" title="Energija ' + e + '/10">';
  for (let i = 1; i <= 5; i++) h += `<i class="${e >= i * 2 - 1 ? "f" : ""}" style="height:${4 + i * 1.6}px"></i>`;
  return h + "</span>";
}
export const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

export function camelotRelation(a, b) {
  if (!a || !b) return { level: "ok", icon: "·", label: "Nepoznat key" };
  const na = parseInt(a), nb = parseInt(b), la = a.slice(-1), lb = b.slice(-1);
  const d = ((nb - na) % 12 + 12) % 12;
  if (la === lb && d === 0) return { level: "good", icon: "=", label: "Isti key" };
  if (la === lb && (d === 1 || d === 11)) return { level: "good", icon: d === 1 ? "↗" : "↘", label: "Susedni key (±1)" };
  if (la !== lb && d === 0) return { level: "good", icon: "⇄", label: "Relativni dur/mol" };
  if (la === lb && (d === 2 || d === 7)) return { level: "ok", icon: "⇈", label: "Energy boost" };
  if (la !== lb && (d === 1 || d === 11)) return { level: "ok", icon: "⤢", label: "Dijagonala" };
  return { level: "bad", icon: "✕", label: "Key clash" };
}

// art: background image with graceful placeholder
const artCache = new Map();
export function setArt(el, id) {
  if (!el) return;
  el.style.backgroundImage = "";
  el.classList.add("ph");
  if (!id) return;
  const url = `/api/art/${id}`;
  const known = artCache.get(id);
  if (known === false) return;
  const apply = () => { el.style.backgroundImage = `url(${url})`; el.classList.remove("ph"); };
  if (known === true) return apply();
  const img = new Image();
  img.onload = () => { artCache.set(id, img.naturalWidth > 0); if (img.naturalWidth > 0) apply(); };
  img.onerror = () => artCache.set(id, false);
  img.src = url;
}

// toasts
export function toast(msg, { kind = "", ms = 4200, actions = [] } = {}) {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.innerHTML = `<div class="msg">${msg}</div>`;
  if (actions.length) {
    const a = document.createElement("div");
    a.className = "acts";
    for (const [label, fn] of actions) {
      const b = document.createElement("button");
      b.className = "btn"; b.textContent = label; b.onclick = () => { fn(); el.remove(); };
      a.appendChild(b);
    }
    el.appendChild(a);
  }
  $("#toasts").appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}
export function progressToast(title) {
  const el = toast(`<b>${esc(title)}</b><div class="sub" style="color:var(--muted)"></div><div class="bar"><i style="width:0"></i></div>`, { ms: 0 });
  return {
    set(p, msg) { el.querySelector(".bar i").style.width = (p * 100).toFixed(0) + "%"; el.querySelector(".sub").textContent = msg || ""; },
    done() { el.remove(); },
  };
}

// overlays
export function closeLayer() { $("#layer").innerHTML = ""; }
export function modal(html) {
  closeLayer();
  const s = document.createElement("div");
  s.className = "scrim";
  s.innerHTML = html;
  s.addEventListener("mousedown", e => { if (e.target === s) closeLayer(); });
  $("#layer").appendChild(s);
  return s;
}
export function popAt(html, x, y, w = 380, cls = "pop") {
  closeLayer();
  const p = document.createElement("div");
  p.className = cls;
  p.innerHTML = html;
  $("#layer").appendChild(p);
  const r = p.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  p.style.top = Math.max(52, Math.min(y, innerHeight - r.height - 64)) + "px";
  setTimeout(() => {
    const off = e => { if (!p.contains(e.target)) { p.remove(); document.removeEventListener("mousedown", off, true); } };
    document.addEventListener("mousedown", off, true);
  });
  return p;
}
document.addEventListener("keydown", e => { if (e.key === "Escape") closeLayer(); });

export async function pickFolder(def = "") {
  const r = await api("/pick_folder", { body: {} });
  if (r && r.path) return r.path;
  return prompt("Putanja foldera:", def);
}

export function sizeCanvas(c) {
  const r = c.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext("2d");
  x.setTransform(d, 0, 0, d, 0, 0);
  return [x, r.width, r.height];
}

export function job(path, body, title, done) {
  const t = progressToast(title);
  api(path, { body }).then(({ job: id }) => {
    const tick = async () => {
      const j = await api("/jobs/" + id);
      if (j.status === "running") { t.set(j.progress, j.msg); setTimeout(tick, 700); }
      else if (j.status === "error") { t.done(); toast("Greška: " + esc(j.msg), { kind: "err", ms: 9000 }); }
      else { t.done(); done(j.result); }
    };
    tick();
  }).catch(e => { t.done(); toast(esc(e.message), { kind: "err" }); });
}
