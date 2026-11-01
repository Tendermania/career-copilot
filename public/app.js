// Career Copilot UI. Vanilla JS, no build step. All data lives on your machine
// (the local server writes to ./data); nothing here talks to third parties.

// ================= Utilities =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const today = () => new Date().toISOString().slice(0, 10);
const lines = (s) => String(s || "").split(/\n/).map((x) => x.trim()).filter(Boolean);
const csv = (s) => String(s || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
function debounce(fn, ms = 400) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function ago(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${Math.floor(d)} days ago`;
  return new Date(iso).toLocaleDateString();
}
function fmtDate(iso) {
  return iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(`cc:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`cc:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};

async function api(method, path, body, { signal, raw } = {}) {
  let r;
  try {
    r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    const err = new Error("Can't reach the Career Copilot server. Is `npm start` still running?");
    err.code = "OFFLINE";
    throw err;
  }
  if (!r.ok) {
    let j = {};
    try { j = await r.json(); } catch { /* not json */ }
    const err = new Error(j.error || `Request failed (${r.status})`);
    err.code = j.code;
    err.status = r.status;
    throw err;
  }
  return raw ? r : r.json();
}

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), kind === "bad" ? 6000 : 3000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("Copied");
}

function download(name, data, type = "text/plain") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

const fileSafe = (s) => String(s || "document").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

// ================= State =================
const S = {
  status: { hasAnthropicKey: false, sources: [], aiTells: [] },
  profile: null, resumes: { activeId: null, items: [] }, tracker: { items: [] }, savedJobs: { items: [] }, documents: { items: [] }, companies: {}, settings: null,
  ui: { job: ls.get("job", { title: "", company: "", location: "", type: "", salary: "", url: "", description: "" }), resumeId: null, jobsTab: "results", lastSearch: ls.get("lastSearch", null) },
  pending: {}, results: {}, errors: {},
};
const STORE_KEYS = { profile: "profile", resumes: "resumes", tracker: "tracker", savedJobs: "saved-jobs", documents: "documents" };
const savers = {};
function save(key, now = false) {
  savers[key] ||= debounce(() => api("PUT", `/api/state/${STORE_KEYS[key]}`, S[key]).catch((e) => toast(`Couldn't save: ${e.message}`, "bad")), 350);
  if (now) return api("PUT", `/api/state/${STORE_KEYS[key]}`, S[key]);
  savers[key]();
}
const saveJob = debounce(() => ls.set("job", S.ui.job), 300);

async function loadAll() {
  const [status, profile, resumes, tracker, savedJobs, documents, companies] = await Promise.all([
    api("GET", "/api/status"), api("GET", "/api/state/profile"), api("GET", "/api/state/resumes"), api("GET", "/api/state/tracker"),
    api("GET", "/api/state/saved-jobs"), api("GET", "/api/state/documents"), api("GET", "/api/state/companies"),
  ]);
  Object.assign(S, {
    status, profile: profile || {}, resumes: resumes || { activeId: null, items: [] }, tracker: tracker || { items: [] },
    savedJobs: savedJobs || { items: [] }, documents: documents || { items: [] }, companies: companies || {},
  });
  S.profile.focuses ||= [];
  S.resumes.items ||= [];
  S.tracker.items ||= [];
  S.savedJobs.items ||= [];
  S.documents.items ||= [];
}
const refreshStatus = async () => { S.status = await api("GET", "/api/status"); };

const activeFocus = () => (S.profile.focuses || []).find((f) => f.id === S.profile.activeFocusId) || S.profile.focuses?.[0] || { label: "Motion graphics", roles: ["Motion Designer"], keywords: [] };
const resumeById = (id) => S.resumes.items.find((r) => r.id === id);
const activeResume = () => resumeById(S.resumes.activeId) || S.resumes.items[0] || null;
const pickedResume = () => resumeById(S.ui.resumeId) || activeResume();
const resumeText = (r) => (r ? r.text || (r.structured ? toText(r.structured) : "") : "");
const jobForAI = (j = S.ui.job) => ({ title: j.title, company: j.company, location: j.location, type: j.type, salary: j.salary, url: j.url, description: j.description });
const hasJob = (j = S.ui.job) => (j.description || "").trim().length > 40;

// ================= AI slots =================
// A slot is a region that shows the loading/error/result of one AI call. Results
// live in S.results, so you can switch tabs while Claude works and come back.
const slots = {};
const slotHTML = (key) => `<div data-slot="${key}"></div>`;

function loadingHTML(key, p) {
  return `<div class="loading" role="status" aria-live="polite"><div class="spinner" aria-hidden="true"></div><div class="grow"><b>${esc(p.label)}</b>
    <div class="small muted"><span data-elapsed="${p.t0}">0</span>s so far · usually ${p.expect < 45 ? "15–45" : "30–90"} seconds. You can use other tabs meanwhile.</div>
    <div class="bar"><span data-bar="${p.t0}" data-expect="${p.expect}"></span></div></div>
    <button class="btn small ghost" data-cancel="${key}">Cancel</button></div>`;
}

function errorHTML(e) {
  if (e.code === "NO_API_KEY") {
    return `<div class="notice info"><div class="grow"><b>This needs an Anthropic API key.</b><br>AI features use your own key. Everything else (ATS check, job search, tracker) works without one.</div><a class="btn small primary" href="#/settings">Add key</a></div>`;
  }
  if (e.code === "NO_RESUME") return `<div class="notice info"><div class="grow">${esc(e.message)}</div><a class="btn small" href="#/resumes">Go to Resumes</a></div>`;
  if (e.code === "NO_JOB") return `<div class="notice info"><div class="grow">${esc(e.message)}</div></div>`;
  if (e.code === "BAD_API_KEY" || e.code === "NO_CREDIT" || e.code === "BAD_MODEL") return `<div class="notice bad"><div class="grow">${esc(e.message)}</div><a class="btn small" href="#/settings">Settings</a></div>`;
  return `<div class="notice bad"><div class="grow"><b>That didn't work.</b> ${esc(e.message)}</div></div>`;
}

function fillSlots(root = document) {
  for (const el of $$("[data-slot]", root)) fillSlot(el);
}
function fillSlot(el) {
  const k = el.dataset.slot;
  if (S.pending[k]) el.innerHTML = loadingHTML(k, S.pending[k]);
  else if (S.errors[k]) el.innerHTML = errorHTML(S.errors[k]);
  else if (S.results[k] != null && slots[k]) {
    // Fresh wrapper each time so re-renders don't stack event listeners.
    const inner = document.createElement("div");
    inner.innerHTML = slots[k].render(S.results[k]);
    el.replaceChildren(inner);
    slots[k].bind?.(inner, S.results[k]);
    initCounters(inner);
  } else el.innerHTML = slots[k]?.empty?.() || "";
}
const refreshSlot = (k) => $$(`[data-slot="${k}"]`).forEach(fillSlot);

async function runAI(key, task, body, { label = "Claude is working…", expect = 60, onDone } = {}) {
  if (S.pending[key]) return;
  if (!S.status.hasAnthropicKey) {
    S.errors[key] = Object.assign(new Error("No API key"), { code: "NO_API_KEY" });
    refreshSlot(key);
    return;
  }
  const ctrl = new AbortController();
  S.pending[key] = { label, expect, t0: Date.now(), ctrl };
  delete S.errors[key];
  refreshSlot(key);
  updateNavBusy();
  try {
    const r = await api("POST", `/api/ai/${task}`, body, { signal: ctrl.signal });
    S.results[key] = r;
    delete S.pending[key];
    await onDone?.(r);
  } catch (e) {
    if (e.name !== "AbortError") S.errors[key] = e;
  } finally {
    delete S.pending[key];
    refreshSlot(key);
    updateNavBusy();
  }
}

setInterval(() => {
  for (const el of $$("[data-elapsed]")) el.textContent = Math.round((Date.now() - Number(el.dataset.elapsed)) / 1000);
  for (const el of $$("[data-bar]")) {
    const s = (Date.now() - Number(el.dataset.bar)) / 1000;
    el.style.width = `${Math.min(95, (s / Number(el.dataset.expect)) * 85)}%`;
  }
}, 1000);

// ================= Global delegated handlers =================
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-cancel]");
  if (c) { S.pending[c.dataset.cancel]?.ctrl.abort(); return; }
  const cp = e.target.closest("[data-copy-from]");
  if (cp) {
    const t = $(cp.dataset.copyFrom);
    if (t) copyText(t.value ?? t.innerText);
    return;
  }
  const cpt = e.target.closest("[data-copy]");
  if (cpt) copyText(cpt.dataset.copy);
});

function updateCounter(ta) {
  const c = ta.nextElementSibling?.classList.contains("counter") ? ta.nextElementSibling : null;
  if (!c) return;
  const n = ta.value.length, lim = Number(ta.dataset.limit) || 0;
  const words = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
  c.textContent = lim ? `${n} / ${lim} characters` : `${n} characters · ${words} words`;
  c.classList.toggle("over", !!lim && n > lim);
}
document.addEventListener("input", (e) => {
  if (e.target.matches("textarea[data-count]")) updateCounter(e.target);
});
const counted = (attrs = "", value = "", limit = 0) => `<textarea data-count ${limit ? `data-limit="${limit}"` : ""} ${attrs}>${esc(value)}</textarea><div class="counter"></div>`;
const initCounters = (root) => $$("textarea[data-count]", root).forEach(updateCounter);

// ================= Text helpers (client) =================
function highlightTells(text) {
  let h = esc(text);
  for (const p of S.status.aiTells || []) {
    const re = new RegExp(`(${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "(?:'|&#39;|’)")})`, "gi");
    h = h.replace(re, '<mark class="tell" title="Sounds generic / AI-written">$1</mark>');
  }
  return h.replace(/\[[^\]\n]{2,60}\]/g, (m) => `<mark class="ph" title="Fill this in">${m}</mark>`);
}
function tellsIn(text) {
  const t = String(text).toLowerCase();
  const hits = (S.status.aiTells || []).filter((p) => t.includes(p));
  const dashes = (String(text).match(/—/g) || []).length;
  if (dashes >= 3) hits.push(`${dashes} em dashes`);
  return hits;
}
const placeholdersIn = (text) => [...new Set(String(text).match(/\[[^\]\n]{2,60}\]/g) || [])];

function toText(r) {
  if (!r) return "";
  const c = r.contact || {};
  const out = [c.name, c.headline, [c.location, c.phone, c.email, ...(c.links || [])].filter(Boolean).join(" | "), ""];
  for (const s of r.sections || []) {
    out.push((s.heading || "").toUpperCase());
    if (s.text) out.push(s.text);
    for (const it of s.items || []) {
      const head = [it.title, it.organization, it.location, it.dates].filter(Boolean).join(" | ");
      if (head) out.push(head);
      if (it.details) out.push(it.details);
      for (const b of it.bullets || []) out.push(`- ${b}`);
    }
    out.push("");
  }
  return out.filter((x) => x != null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function wordDiff(a, b) {
  const A = String(a || "").split(/(\s+)/), B = String(b || "").split(/(\s+)/);
  if (A.length * B.length > 250000) return `<del>${esc(a)}</del> <ins>${esc(b)}</ins>`;
  const m = A.length, n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, out = "";
  while (i < m && j < n) {
    if (A[i] === B[j]) { out += esc(A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out += `<del>${esc(A[i])}</del>`; i++; }
    else { out += `<ins>${esc(B[j])}</ins>`; j++; }
  }
  while (i < m) out += `<del>${esc(A[i++])}</del>`;
  while (j < n) out += `<ins>${esc(B[j++])}</ins>`;
  return out.replace(/<\/del><del>/g, "").replace(/<\/ins><ins>/g, "");
}

// ================= Resume rendering =================
function applyCase(s, mode) {
  s = String(s || "");
  if (mode === "UPPERCASE") return s.toUpperCase();
  if (mode === "Title Case") return s.replace(/\w\S*/g, (w) => (/^(and|of|the|in|for)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)));
  if (mode === "Sentence case") return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return s;
}

function layoutFrom(fmt = {}) {
  const l = String(fmt.itemLayout || "").toLowerCase();
  const tokens = [["title", /title|role|position|degree/], ["organization", /company|organi[sz]ation|org\b|employer|school|client|studio/], ["location", /location|city/], ["dates", /date/]];
  const order = tokens.map(([k, re]) => [k, l.search(re)]).filter((x) => x[1] >= 0).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  const sep = (l.match(/\s[|•·–—-]\s|,\s/) || [" | "])[0];
  return { order: order.length >= 2 ? order : ["title", "organization", "location", "dates"], sep, datesRight: !order.length || order[order.length - 1] === "dates" };
}

function linkify(s) {
  const t = String(s || "");
  if (/@/.test(t) && !/\s/.test(t)) return `<a href="mailto:${esc(t)}">${esc(t)}</a>`;
  if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t)) return `<a href="${esc(/^https?:/i.test(t) ? t : `https://${t}`)}">${esc(t)}</a>`;
  return esc(t);
}

function renderResume(r, template = "original") {
  if (!r) return "";
  const fmt = r.format || {};
  const c = r.contact || {};
  const original = template === "original";
  const hcase = original ? fmt.headingCase || "UPPERCASE" : template === "modern" ? "Title Case" : "UPPERCASE";
  const bullet = original && fmt.bulletChar ? fmt.bulletChar.trim().slice(0, 2) : "•";
  const lay = layoutFrom(fmt);
  const contact = [c.location, c.phone, c.email, ...(c.links || [])].filter(Boolean).map(linkify).join(original ? esc(lay.sep.includes("|") ? "  |  " : "  ·  ") : "  ·  ");
  let h = `<article class="paper tpl-${template}" style="--bullet:'${bullet.replace(/'/g, "")} '">`;
  h += `<header><h1 class="rs-name">${esc(c.name)}</h1>${c.headline ? `<p class="rs-headline">${esc(c.headline)}</p>` : ""}${contact ? `<p class="rs-contact">${contact}</p>` : ""}</header>`;
  for (const s of r.sections || []) {
    h += `<section class="rs-section"><h2 class="rs-heading">${esc(applyCase(s.heading, hcase))}</h2>`;
    if (s.text) h += `<p class="rs-text">${esc(s.text)}</p>`;
    for (const it of s.items || []) {
      let left, right;
      if (original) {
        const ord = lay.datesRight ? lay.order.filter((k) => k !== "dates") : lay.order;
        left = ord.map((k) => it[k]).filter(Boolean).map((v, i) => (i === 0 ? `<b>${esc(v)}</b>` : esc(v))).join(esc(lay.sep));
        right = lay.datesRight ? esc(it.dates || "") : "";
      } else {
        left = [it.title && `<b>${esc(it.title)}</b>`, it.organization && esc(it.organization)].filter(Boolean).join(template === "modern" ? " — " : ", ");
        right = [it.location, it.dates].filter(Boolean).map(esc).join(" · ");
      }
      h += `<div class="rs-item">${left || right ? `<div class="rs-line"><span>${left}</span><span class="rs-right">${right}</span></div>` : ""}`;
      if (it.details) h += `<p class="rs-details">${esc(it.details)}</p>`;
      if (it.bullets?.length) h += `<ul class="rs-bullets">${it.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
      h += `</div>`;
    }
    h += `</section>`;
  }
  return h + `</article>`;
}

function printHTML(html) {
  $("#printArea").innerHTML = html;
  setTimeout(() => window.print(), 50);
}

async function exportDocx(payload, name) {
  try {
    const r = await api("POST", "/api/export/docx", payload, { raw: true });
    download(name, await r.blob());
  } catch (e) {
    toast(e.message, "bad");
  }
}

// Shared export bar for a structured resume.
function resumeExportBar(id) {
  return `<div class="row" data-export="${id}">
    <div class="seg" role="radiogroup" aria-label="Template">${["original", "classic", "modern", "compact"].map((t, i) => `<label><input type="radio" name="tpl-${id}" value="${t}" ${i === 0 ? "checked" : ""}>${t === "original" ? "Original format" : t[0].toUpperCase() + t.slice(1)}</label>`).join("")}</div>
    <span class="grow"></span>
    <button class="btn small" data-act="print">Print / PDF</button>
    <button class="btn small" data-act="docx">DOCX</button>
    <button class="btn small" data-act="txt">Plain text</button>
    <button class="btn small ghost" data-act="copy">Copy text</button>
  </div><div class="resume-preview" data-preview="${id}" style="margin-top:12px"></div>`;
}
function bindResumeExport(root, id, getResume) {
  const bar = $(`[data-export="${id}"]`, root);
  const prev = $(`[data-preview="${id}"]`, root);
  if (!bar) return;
  const tpl = () => $("input[type=radio]:checked", bar)?.value || "original";
  const draw = () => { prev.innerHTML = renderResume(getResume(), tpl()); };
  bar.addEventListener("change", draw);
  bar.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const r = getResume();
    const base = fileSafe(`${r.contact?.name || "Resume"}-${activeFocus().roles?.[0] || "Resume"}`);
    if (act === "print") printHTML(renderResume(r, tpl()));
    if (act === "docx") exportDocx({ kind: "resume", resume: r, template: tpl() }, `${base}.docx`);
    if (act === "txt") download(`${base}.txt`, toText(r));
    if (act === "copy") copyText(toText(r));
  });
  draw();
}

// ================= Shared pickers =================
function jobOptions() {
  const saved = S.savedJobs.items.map((j) => `<option value="saved:${esc(j.id)}">${esc(j.title)} — ${esc(j.company)}</option>`).join("");
  const tracked = S.tracker.items.filter((t) => t.description).map((t) => `<option value="tracker:${esc(t.id)}">${esc(t.role)} — ${esc(t.company)} (tracker)</option>`).join("");
  return `<option value="">Pick a saved job…</option>${saved}${tracked}`;
}

function jobPickerHTML(prefix, { compact = false } = {}) {
  const j = S.ui.job;
  return `<div class="job-picker" data-jp="${prefix}">
    ${S.savedJobs.items.length || S.tracker.items.some((t) => t.description) ? `<div class="field"><select data-jsel aria-label="Pick a saved job">${jobOptions()}</select></div>` : ""}
    <div class="grid cols-2"><div class="field"><label>Job title</label><input type="text" data-jf="title" value="${esc(j.title)}" placeholder="Motion Designer"></div>
    <div class="field"><label>Company</label><input type="text" data-jf="company" value="${esc(j.company)}" placeholder="Studio or company"></div></div>
    <div class="field"><label>Job description <span class="hint">paste the whole posting</span></label><textarea data-jf="description" class="${compact ? "" : "tall"}" placeholder="Paste the job posting here…">${esc(j.description)}</textarea></div>
  </div>`;
}
function bindJobPicker(root, onChange = () => {}) {
  for (const jp of $$("[data-jp]", root)) {
    $$("[data-jf]", jp).forEach((el) => el.addEventListener("input", () => { S.ui.job[el.dataset.jf] = el.value; saveJob(); onChange(); }));
    $("[data-jsel]", jp)?.addEventListener("change", (e) => {
      const [kind, id] = e.target.value.split(":");
      const src = kind === "saved" ? S.savedJobs.items.find((x) => x.id === id) : S.tracker.items.find((x) => x.id === id);
      if (!src) return;
      setWorkingJob(kind === "saved" ? src : { title: src.role, company: src.company, location: src.location, type: src.type, salary: src.salary, url: src.url, description: src.description });
      for (const f of ["title", "company", "description"]) $(`[data-jf="${f}"]`, jp).value = S.ui.job[f] || "";
      onChange();
    });
  }
}
function setWorkingJob(j) {
  S.ui.job = { id: j.id, title: j.title || "", company: j.company || "", location: j.location || "", type: j.type || "", salary: j.salary || "", url: j.applyUrl || j.url || "", description: j.description || "" };
  saveJob();
}

function resumePickerHTML(label = "Resume version") {
  if (!S.resumes.items.length) return `<div class="notice info"><div class="grow">No resume yet.</div><a class="btn small" href="#/resumes">Add one</a></div>`;
  const cur = pickedResume()?.id;
  return `<div class="field"><label>${esc(label)}</label><select data-rsel>${S.resumes.items.map((r) => `<option value="${esc(r.id)}" ${r.id === cur ? "selected" : ""}>${esc(r.name)}${r.id === S.resumes.activeId ? " (active)" : ""}</option>`).join("")}</select></div>`;
}
function bindResumePicker(root, onChange = () => {}) {
  $$("[data-rsel]", root).forEach((el) => el.addEventListener("change", () => { S.ui.resumeId = el.value; onChange(); }));
}

function resumeForAI(r) {
  return r ? { text: r.text || toText(r.structured), structured: r.structured || null } : null;
}

// Structured resume editor (used for editing any version, AI output included).
function structuredEditorHTML(r) {
  const c = r.contact || {};
  let h = `<div class="grid cols-2">
    ${["name", "headline", "email", "phone", "location"].map((f) => `<div class="field"><label>${f[0].toUpperCase() + f.slice(1)}</label><input type="text" data-sp="contact.${f}" value="${esc(c[f])}"></div>`).join("")}
    <div class="field"><label>Links <span class="hint">one per line</span></label><textarea data-sp="contact.links" data-kind="lines" rows="2" style="min-height:60px">${esc((c.links || []).join("\n"))}</textarea></div></div>`;
  (r.sections || []).forEach((s, i) => {
    h += `<div class="card" style="margin-top:12px;background:var(--surface-2)"><div class="card-head"><input type="text" data-sp="sections.${i}.heading" value="${esc(s.heading)}" aria-label="Section heading" style="font-weight:700;max-width:340px"><span class="badge">${esc(s.kind)}</span></div>`;
    if (s.text || !(s.items || []).length) h += `<div class="field"><label>Text</label><textarea data-sp="sections.${i}.text">${esc(s.text)}</textarea></div>`;
    (s.items || []).forEach((it, j) => {
      h += `<div class="card" style="margin-top:8px"><div class="grid cols-4">${["title", "organization", "location", "dates"].map((f) => `<div class="field"><label>${f[0].toUpperCase() + f.slice(1)}</label><input type="text" data-sp="sections.${i}.items.${j}.${f}" value="${esc(it[f])}"></div>`).join("")}</div>
        ${it.details ? `<div class="field"><label>Details</label><textarea data-sp="sections.${i}.items.${j}.details" style="min-height:60px">${esc(it.details)}</textarea></div>` : ""}
        <div class="field"><label>Bullets <span class="hint">one per line</span></label><textarea data-sp="sections.${i}.items.${j}.bullets" data-kind="lines">${esc((it.bullets || []).join("\n"))}</textarea></div>
        <div class="row end"><button class="btn small ghost danger" data-rm-item="${i}.${j}">Remove item</button></div></div>`;
    });
    h += `<div class="row" style="margin-top:8px"><button class="btn small" data-add-item="${i}">+ Add item</button></div></div>`;
  });
  return h;
}
function setPath(obj, path, val) {
  const ks = path.split(".");
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] ??= /^\d+$/.test(ks[i + 1]) ? [] : {};
  o[ks.at(-1)] = val;
}
function bindStructuredEditor(root, r, onChange, rerender) {
  root.addEventListener("input", (e) => {
    const el = e.target.closest("[data-sp]");
    if (!el) return;
    setPath(r, el.dataset.sp, el.dataset.kind === "lines" ? lines(el.value) : el.value);
    onChange();
  });
  root.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add-item]");
    const rm = e.target.closest("[data-rm-item]");
    if (add) { r.sections[+add.dataset.addItem].items.push({ title: "", organization: "", location: "", dates: "", bullets: [], details: "" }); onChange(); rerender(); }
    if (rm) { const [i, j] = rm.dataset.rmItem.split(".").map(Number); r.sections[i].items.splice(j, 1); onChange(); rerender(); }
  });
}

function dialog(html, { onOpen } = {}) {
  const d = document.createElement("dialog");
  d.innerHTML = html;
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
  d.showModal();
  onOpen?.(d);
  return d;
}

function scoreRing(v, sm = false) {
  const c = v >= 75 ? "var(--good)" : v >= 50 ? "var(--accent)" : v >= 30 ? "var(--warn)" : "var(--bad)";
  return `<div class="score ${sm ? "sm" : ""}" style="--v:${v};--c:${c}" role="img" aria-label="Score ${v} of 100"><span>${v}</span></div>`;
}
const sevBadge = (s) => `<span class="badge ${s === "high" || s === "dealbreaker" ? "bad" : s === "medium" || s === "major" ? "warn" : "info"}">${esc(s)}</span>`;
const list = (arr, cls = "plain") => (arr?.length ? `<ul class="${cls}">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted small">None.</p>`);
const editableList = (arr) => (arr?.length ? `<ul class="plain">${arr.map((x) => `<li contenteditable="true">${esc(x)}</li>`).join("")}</ul>` : `<p class="muted small">None.</p>`);

function saveDocument(type, title, data, jobRef = S.ui.job) {
  const doc = { id: uid(), type, title, createdAt: new Date().toISOString(), job: { title: jobRef.title, company: jobRef.company }, data };
  S.documents.items.unshift(doc);
  save("documents");
  toast("Saved");
  return doc;
}

// ================= Router / navigation =================
const ICONS = {
  dashboard: '<path d="M4 13h6V4H4zm10 7h6V11h-6zM4 20h6v-4H4zm10-11h6V4h-6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  profile: '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  resumes: '<path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5M10 13h6M10 17h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  evaluate: '<path d="M4 18l5-5 4 4 7-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 9h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  ats: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 12l2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  jobs: '<rect x="3" y="7" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 7V5h6v2M3 12h18" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  companies: '<path d="M4 21V5l8-2v18M12 8h8v13M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2M2 21h20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  networking: '<circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6" stroke="currentColor" stroke-width="1.8"/>',
  cover: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 7l9 6 9-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  interview: '<path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  tracker: '<path d="M5 4v16M12 4v10M19 4v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  settings: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};
const VIEWS = {};
const NAV = [
  ["Overview", ["dashboard", "profile", "resumes"]],
  ["Apply", ["evaluate", "ats", "jobs", "companies"]],
  ["Reach out", ["networking", "cover", "interview"]],
  ["Manage", ["tracker", "settings"]],
];
function view(id, title, render) {
  VIEWS[id] = { id, title, render };
}

function renderNav() {
  const cur = currentRoute().id;
  const due = S.tracker.items.filter(isFollowUpDue).length;
  $("#sidebar").innerHTML = NAV.map(([g, ids]) => `<div class="nav-group">${g}</div>${ids.map((id) => `<a href="#/${id}" ${id === cur ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>${VIEWS[id].title}${id === "tracker" && due ? `<span class="badge warn">${due}</span>` : ""}<span class="badge accent" data-busy="${id}" hidden>…</span></a>`).join("")}`).join("");
  updateNavBusy();
  const fp = $("#focusPill");
  fp.innerHTML = (S.profile.focuses || []).map((f) => `<option value="${esc(f.id)}" ${f.id === activeFocus().id ? "selected" : ""}>${esc(f.label)}</option>`).join("");
}
const BUSY_MAP = { evaluate: ["evaluate", "tailor"], jobs: ["jobs"], companies: ["company"], networking: ["referral", "outreach"], cover: ["cover", "humanize"], interview: ["interview"], profile: ["about"], resumes: ["structure"], ats: ["extract"] };
function updateNavBusy() {
  for (const el of $$("[data-busy]")) el.hidden = !(BUSY_MAP[el.dataset.busy] || []).some((k) => S.pending[k]);
}

function currentRoute() {
  const [id, q] = location.hash.replace(/^#\/?/, "").split("?");
  return { id: VIEWS[id] ? id : "dashboard", params: new URLSearchParams(q || "") };
}
function go(id, params = "") {
  location.hash = `#/${id}${params ? `?${params}` : ""}`;
}
function render() {
  const { id, params } = currentRoute();
  const v = VIEWS[id];
  document.title = `${v.title} · Career Copilot`;
  renderNav();
  // Fresh <main> per render so listeners attached by the previous view don't pile up.
  const old = $("#main");
  const main = old.cloneNode(false);
  old.replaceWith(main);
  v.render(main, params);
  fillSlots(main);
  initCounters(main);
  closeMenu();
}
const rerender = () => {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
};
function closeMenu() {
  $("#sidebar").classList.remove("open");
  $("#scrim").hidden = true;
  $("#menuBtn").setAttribute("aria-expanded", "false");
}
const pageHead = (title, sub, actions = "") => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div>${actions ? `<div class="row">${actions}</div>` : ""}</div>`;

// ================= Dashboard =================
const STATUSES = ["saved", "applied", "interviewing", "offer", "rejected", "ghosted"];
const STATUS_LABEL = { saved: "Saved", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", ghosted: "Ghosted" };
function isFollowUpDue(t) {
  return t.followUpAt && t.followUpAt <= today() && ["saved", "applied", "interviewing"].includes(t.status);
}

view("dashboard", "Dashboard", (main) => {
  const p = S.profile, f = activeFocus();
  const items = S.tracker.items;
  const due = items.filter(isFollowUpDue);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, items.filter((t) => t.status === s).length]));
  const last = S.ui.lastSearch;
  const savedIds = new Set(S.savedJobs.items.map((j) => j.id));
  const matches = (last?.jobs || []).filter((j) => !savedIds.has(j.id) && j.fit?.score >= 40).slice(0, 6);
  const r = activeResume();

  const actions = [];
  if (!S.status.hasAnthropicKey) actions.push(["Add your Anthropic API key to turn on evaluation, tailoring and writing help.", "#/settings", "Settings"]);
  if (!p.name || !p.whoIAm) actions.push(["Tell Career Copilot who you are. It's what makes the writing sound like you.", "#/profile", "Profile"]);
  if (!r) actions.push(["Add your resume (PDF, DOCX or paste).", "#/resumes", "Resumes"]);
  else if (!r.structured && S.status.hasAnthropicKey) actions.push([`Structure "${r.name}" so tailoring can keep its format.`, "#/resumes", "Resumes"]);
  for (const t of due) actions.push([`Follow up with ${t.company} about ${t.role}${t.contacts ? ` (${t.contacts.split("\n")[0]})` : ""}.`, "#/tracker", "Tracker"]);
  const savedNotApplied = S.savedJobs.items.filter((j) => !items.some((t) => t.jobId === j.id && t.status !== "saved")).length;
  if (savedNotApplied) actions.push([`${savedNotApplied} saved job${savedNotApplied > 1 ? "s" : ""} waiting. Evaluate one and apply.`, "#/jobs?tab=saved", "Saved jobs"]);
  if (!last || Date.now() - new Date(last.at).getTime() > 2 * 86400000) actions.push(["Run a fresh job search. New postings appear daily.", "#/jobs", "Jobs"]);
  const interviewing = items.filter((t) => t.status === "interviewing");
  for (const t of interviewing.slice(0, 2)) actions.push([`Prep for your ${t.company} interview.`, "#/interview", "Interview prep"]);

  main.innerHTML = `${pageHead(p.name ? `Hi ${p.name.split(" ")[0]}` : "Welcome", `Focus: <b>${esc(f.label)}</b> · ${esc((f.roles || []).slice(0, 3).join(", "))}`)}
  ${!S.status.hasAnthropicKey ? `<div class="notice info" style="margin-bottom:14px"><div class="grow"><b>Running without AI.</b> ATS checks, job search, saving jobs and the tracker all work now. Add an Anthropic key in Settings for evaluation, tailoring, cover letters and outreach.</div><a class="btn small primary" href="#/settings">Add key</a></div>` : ""}
  <div class="grid cols-4">
    <div class="card"><div class="stat">${items.filter((t) => ["applied", "interviewing"].includes(t.status)).length}</div><div class="stat-label">Active applications</div></div>
    <div class="card"><div class="stat" style="color:${due.length ? "var(--bad)" : "inherit"}">${due.length}</div><div class="stat-label">Follow-ups due</div></div>
    <div class="card"><div class="stat">${counts.interviewing}</div><div class="stat-label">Interviewing</div></div>
    <div class="card"><div class="stat">${S.savedJobs.items.length}</div><div class="stat-label">Saved jobs</div></div>
  </div>
  <div class="grid cols-2" style="margin-top:14px">
    <div class="card"><div class="card-head"><h2>Next actions</h2></div>
      ${actions.length ? `<ul class="list">${actions.slice(0, 8).map(([t, href, lbl]) => `<li class="row"><span class="grow">${esc(t)}</span><a class="btn small" href="${href}">${esc(lbl)}</a></li>`).join("")}</ul>` : `<p class="muted">You're on top of things. Nice.</p>`}
    </div>
    <div class="card"><div class="card-head"><h2>Follow-ups due</h2><span class="spacer"></span><a class="btn small ghost" href="#/tracker">Tracker</a></div>
      ${due.length ? `<ul class="list">${due.map((t) => `<li><b>${esc(t.role)}</b> · ${esc(t.company)}<div class="small muted">Due ${fmtDate(t.followUpAt)} · ${STATUS_LABEL[t.status]}${t.appliedAt ? ` · applied ${fmtDate(t.appliedAt)}` : ""}</div></li>`).join("")}</ul>` : `<p class="muted">Nothing due. Set follow-up dates in the tracker (about a week after applying is typical).</p>`}
    </div>
  </div>
  <div class="card" style="margin-top:14px"><div class="card-head"><h2>New matches</h2><span class="muted small">${last ? `from your search ${ago(last.at)}` : ""}</span><span class="spacer"></span><a class="btn small" href="#/jobs">Search jobs</a></div>
    ${matches.length ? `<ul class="list">${matches.map((j) => `<li class="row">${scoreRing(j.fit.score, true)}<div class="grow"><a href="${esc(j.applyUrl || j.url)}" target="_blank" rel="noopener"><b>${esc(j.title)}</b></a> · ${esc(j.company)}<div class="small muted">${esc(j.type)} · ${j.remote ? "Remote" : esc(j.location)} · ${esc(j.source)} · ${ago(j.postedAt)}</div></div></li>`).join("")}</ul>` : `<p class="muted">No matches yet. Run a search in Jobs.</p>`}
  </div>
  <div class="card" style="margin-top:14px"><div class="card-head"><h2>Pipeline</h2></div>
    <div class="row">${STATUSES.map((s) => `<div style="min-width:110px"><div class="stat">${counts[s]}</div><div class="stat-label">${STATUS_LABEL[s]}</div></div>`).join("")}</div>
  </div>`;
});

// ================= Profile =================
const PROFILE_FIELDS = [
  ["whoIAm", "Who I am", "In your own words. Background, what drives you, what makes you you."],
  ["whatIDo", "What I do", "Your craft. E.g. 2D/3D motion for brands and products, UI animation in Rive, editing."],
  ["proudestWork", "Work I'm proudest of", "2-3 projects with what you did and what happened."],
  ["values", "What matters to me in a job", "Team, craft, stability, mission, pay, growth…"],
  ["workStyle", "How I like to work", "Async/sync, solo vs. team, feedback style, pace."],
  ["story", "Career story", "Pivots, gaps, why this field. Used to explain things honestly."],
  ["goals", "Goals", "Next 1-3 years."],
  ["dealBreakers", "Deal-breakers", "Unpaid tests, on-site only, crunch culture…"],
];

view("profile", "Profile", (main) => {
  const p = S.profile;
  p.preferences ||= {};
  const f = activeFocus();
  main.innerHTML = `${pageHead("Who I am", "This is the human part. Everything Claude writes for you draws on it, so it sounds like you and tells your real story. Saved automatically.")}
  <div class="split">
    <div class="stack">
      <div class="card"><h2>Basics</h2>
        <div class="field"><label>Name</label><input type="text" data-pk="name" value="${esc(p.name)}"></div>
        <div class="field"><label>Headline</label><input type="text" data-pk="headline" value="${esc(p.headline)}" placeholder="Motion Designer · 2D/3D · Rive & Lottie"></div>
        <div class="field"><label>Location</label><input type="text" data-pk="location" value="${esc(p.location)}"></div>
        <div class="field"><label>Links <span class="hint">portfolio, reel, LinkedIn — one per line</span></label><textarea data-pk="links" data-kind="lines" style="min-height:80px">${esc((p.links || []).join("\n"))}</textarea></div>
      </div>
      <div class="card"><h2>Preferences</h2>
        <label>Workplace</label><div style="margin-bottom:10px">${["Remote", "Hybrid", "On-site"].map((w) => `<label class="check"><input type="checkbox" data-pref="workplace" value="${w}" ${(p.preferences.workplace || []).includes(w) ? "checked" : ""}>${w}</label>`).join("")}</div>
        <label>Employment types</label><div style="margin-bottom:10px">${["Full-time", "Part-time", "Contract", "Contract-to-hire", "Freelance", "Internship"].map((w) => `<label class="check"><input type="checkbox" data-pref="types" value="${w}" ${(p.preferences.types || []).includes(w) ? "checked" : ""}>${w}</label>`).join("")}</div>
        <div class="grid cols-2"><div class="field"><label>Minimum pay</label><input type="text" data-prefk="minPay" value="${esc(p.preferences.minPay)}" placeholder="$85k or $60/hr"></div>
        <div class="field"><label>Locations</label><input type="text" data-prefk="locations" value="${esc(p.preferences.locations)}" placeholder="NYC, US remote"></div></div>
      </div>
      <div class="card"><div class="card-head"><h2>Job focuses</h2><span class="spacer"></span><button class="btn small" id="addFocus">+ New focus</button></div>
        <p class="small muted">Each focus has its own target roles and keywords. Switch the active one from the top bar.</p>
        <div class="field"><label>Editing</label><select id="focusSel">${p.focuses.map((x) => `<option value="${esc(x.id)}" ${x.id === f.id ? "selected" : ""}>${esc(x.label)}${x.id === p.activeFocusId ? " (active)" : ""}</option>`).join("")}</select></div>
        <div id="focusForm"></div>
      </div>
    </div>
    <div class="stack">
      <div class="card"><div class="card-head"><h2>About you</h2><span class="spacer"></span><button class="btn small" id="helpWrite"><span class="ai-dot"></span>Help me write this</button></div>
        <div id="aboutHelper" hidden class="stack" style="margin-bottom:14px">
          <div class="field"><label>Rough answers <span class="hint">bullet points, half sentences, anything</span></label><textarea id="aboutAnswers" placeholder="- started in graphic design, moved to motion in 2019&#10;- love UI animation, did the Rive onboarding for X&#10;- want a small in-house team, remote">${esc(S.ui.aboutAnswers || "")}</textarea></div>
          <div class="row"><button class="btn primary" id="aboutRun"><span class="ai-dot"></span>Draft it</button></div>
          ${slotHTML("about")}
        </div>
        ${PROFILE_FIELDS.map(([k, label, hint]) => `<div class="field"><label for="pf-${k}">${label} <span class="hint">${hint}</span></label><textarea id="pf-${k}" data-pk="${k}">${esc(p[k])}</textarea></div>`).join("")}
      </div>
      <div class="card"><h2>Voice samples</h2><p class="small muted">Paste 2-4 things you've written yourself: emails, posts, a past cover letter you liked. Claude matches this voice.</p>
        <textarea data-pk="voiceSamples" class="tall">${esc(p.voiceSamples)}</textarea>
      </div>
    </div>
  </div>`;

  main.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.pk) { p[el.dataset.pk] = el.dataset.kind === "lines" ? lines(el.value) : el.value; save("profile"); }
    if (el.dataset.prefk) { p.preferences[el.dataset.prefk] = el.value; save("profile"); }
    if (el.id === "aboutAnswers") S.ui.aboutAnswers = el.value;
  });
  main.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.pref) { p.preferences[el.dataset.pref] = $$(`[data-pref="${el.dataset.pref}"]:checked`, main).map((x) => x.value); save("profile"); }
  });

  let editing = f.id;
  const drawFocus = () => {
    const x = p.focuses.find((y) => y.id === editing) || p.focuses[0];
    if (!x) { $("#focusForm").innerHTML = ""; return; }
    $("#focusForm").innerHTML = `
      <div class="field"><label>Label</label><input type="text" data-fk="label" value="${esc(x.label)}"></div>
      <div class="field"><label>Target roles <span class="hint">comma or new line</span></label><textarea data-fk="roles" data-kind="csv" style="min-height:70px">${esc((x.roles || []).join(", "))}</textarea></div>
      <div class="field"><label>Keywords / tools</label><textarea data-fk="keywords" data-kind="csv" style="min-height:70px">${esc((x.keywords || []).join(", "))}</textarea></div>
      <div class="field"><label>Avoid <span class="hint">jobs mentioning these rank lower</span></label><input type="text" data-fk="avoidKeywords" data-kind="csv" value="${esc((x.avoidKeywords || []).join(", "))}" placeholder="unpaid, commission only"></div>
      <div class="grid cols-2"><div class="field"><label>Industries</label><input type="text" data-fk="industries" data-kind="csv" value="${esc((x.industries || []).join(", "))}" placeholder="tech, games, broadcast"></div>
      <div class="field"><label>Seniority</label><input type="text" data-fk="seniority" value="${esc(x.seniority)}" placeholder="mid / senior"></div></div>
      <div class="row">${x.id === p.activeFocusId ? `<span class="badge good">Active</span>` : `<button class="btn small primary" id="activateFocus">Make active</button>`}<span class="grow"></span>${p.focuses.length > 1 ? `<button class="btn small ghost danger" id="delFocus">Delete</button>` : ""}</div>`;
    $("#focusForm").oninput = (e) => {
      const el = e.target.closest("[data-fk]");
      if (!el) return;
      x[el.dataset.fk] = el.dataset.kind === "csv" ? csv(el.value) : el.value;
      save("profile");
      if (el.dataset.fk === "label") renderNav();
    };
    $("#activateFocus")?.addEventListener("click", () => { p.activeFocusId = x.id; save("profile"); rerender(); });
    $("#delFocus")?.addEventListener("click", () => {
      if (!confirm(`Delete the focus "${x.label}"?`)) return;
      p.focuses = p.focuses.filter((y) => y.id !== x.id);
      if (p.activeFocusId === x.id) p.activeFocusId = p.focuses[0]?.id;
      save("profile");
      rerender();
    });
  };
  drawFocus();
  $("#focusSel").addEventListener("change", (e) => { editing = e.target.value; drawFocus(); });
  $("#addFocus").addEventListener("click", () => {
    const n = { id: uid(), label: "New focus", roles: [], keywords: [], avoidKeywords: [], industries: [], seniority: "" };
    p.focuses.push(n);
    save("profile");
    editing = n.id;
    rerender();
  });
  $("#helpWrite").addEventListener("click", () => { $("#aboutHelper").hidden = !$("#aboutHelper").hidden; });
  if (S.pending.about || S.results.about || S.errors.about) $("#aboutHelper").hidden = false;
  $("#aboutRun").addEventListener("click", () => runAI("about", "aboutDraft", { answers: $("#aboutAnswers").value }, { label: "Drafting your About text…", expect: 40 }));
});

slots.about = {
  render: (r) => {
    const d = r.data;
    return `<div class="card" style="background:var(--surface-2)"><p class="small muted">Edit anything, then use what you like. Nothing is saved until you click “Use”.</p>
      ${[["headline", "Headline"], ["whoIAm", "Who I am"], ["whatIDo", "What I do"], ["elevatorPitch", "Elevator pitch"]].map(([k, l]) => `<div class="field"><label>${l}</label><textarea data-draft="${k}" ${k === "headline" ? 'style="min-height:44px"' : ""}>${esc(d[k])}</textarea>
      <div class="row end" style="margin-top:4px">${k !== "elevatorPitch" ? `<button class="btn small" data-use="${k}">Use</button>` : ""}<button class="btn small ghost" data-copy-from="[data-draft='${k}']">Copy</button></div></div>`).join("")}
      ${d.followUpQuestions?.length ? `<h4>To make it more specific</h4>${list(d.followUpQuestions)}` : ""}</div>`;
  },
  bind: (el) => {
    el.addEventListener("click", (e) => {
      const k = e.target.closest("[data-use]")?.dataset.use;
      if (!k) return;
      S.profile[k] = $(`[data-draft="${k}"]`, el).value;
      save("profile");
      const target = document.querySelector(`[data-pk="${k}"]`);
      if (target) target.value = S.profile[k];
      toast("Added to your profile");
    });
  },
};

// ================= Resumes =================
async function readFileAsBase64(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}

async function addResumeFromFile(file) {
  if (file.size > 15 * 1024 * 1024) return toast("That file is over 15 MB.", "bad");
  toast(`Reading ${file.name}…`);
  try {
    const data = await readFileAsBase64(file);
    const r = await api("POST", "/api/parse", { name: file.name, mime: file.type, data });
    const item = { id: uid(), name: file.name.replace(/\.[^.]+$/, ""), createdAt: new Date().toISOString(), text: r.text, meta: r.meta, structured: null, source: "upload" };
    S.resumes.items.unshift(item);
    if (!S.resumes.activeId) S.resumes.activeId = item.id;
    S.ui.resumeSel = item.id;
    await save("resumes", true);
    toast("Resume added");
    rerender();
    if (S.status.hasAnthropicKey) structureResume(item);
  } catch (e) {
    toast(e.message, "bad");
  }
}

function structureResume(item) {
  return runAI("structure", "structureResume", { text: item.text }, {
    label: `Reading the structure of “${item.name}”…`, expect: 40,
    onDone: (r) => {
      item.structured = r.data;
      save("resumes");
      if (currentRoute().id === "resumes") rerender();
    },
  });
}

view("resumes", "Resumes", (main) => {
  const items = S.resumes.items;
  S.ui.resumeSel = resumeById(S.ui.resumeSel)?.id || S.resumes.activeId || items[0]?.id;
  const sel = resumeById(S.ui.resumeSel);
  main.innerHTML = `${pageHead("Resumes", "Keep several versions. The active one is used by default everywhere. Uploads stay on this computer.")}
  <div class="split">
    <div class="stack">
      <div class="card"><h2>Add a resume</h2>
        <div class="dropzone" id="drop" tabindex="0" role="button" aria-label="Upload a resume file"><b>Drop a PDF, DOCX or TXT</b><br><span class="small">or click to choose</span></div>
        <input type="file" id="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden>
        <details style="margin-top:12px"><summary class="small" style="cursor:pointer">Paste text instead</summary>
          <div class="field" style="margin-top:8px"><label>Name</label><input type="text" id="pasteName" placeholder="Motion resume 2026"></div>
          <div class="field"><textarea id="pasteText" class="tall" placeholder="Paste your resume text…"></textarea></div>
          <button class="btn" id="pasteSave">Save pasted resume</button>
        </details>
      </div>
      <div class="card"><h2>Versions</h2>
        ${items.length ? `<ul class="list">${items.map((r) => `<li><div class="row"><label class="check" style="margin:0" title="Make active"><input type="radio" name="activeRes" value="${esc(r.id)}" ${r.id === S.resumes.activeId ? "checked" : ""}><span class="sr-only">Active</span></label>
          <button class="btn ghost small grow" style="justify-content:flex-start;text-align:left;white-space:normal" data-open="${esc(r.id)}"><b>${esc(r.name)}</b></button>
          ${r.id === sel?.id ? '<span class="badge accent">open</span>' : ""}</div>
          <div class="small muted" style="padding-left:30px">${fmtDate(r.createdAt)} · ${esc(r.source === "tailored" ? `tailored${r.job?.company ? ` for ${r.job.company}` : ""}` : r.meta?.type?.toUpperCase() || "pasted")}${r.structured ? " · structured" : ""}${r.id === S.resumes.activeId ? " · <b>active</b>" : ""}</div></li>`).join("")}</ul>` : `<p class="muted">No resumes yet.</p>`}
      </div>
    </div>
    <div class="stack">${sel ? resumeDetailHTML(sel) : `<div class="card empty">Add a resume to see it here.</div>`}</div>
  </div>`;

  const drop = $("#drop"), file = $("#file");
  drop.addEventListener("click", () => file.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
  file.addEventListener("change", () => file.files[0] && addResumeFromFile(file.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("drag"); const f = e.dataTransfer.files[0]; if (f) addResumeFromFile(f); });
  $("#pasteSave").addEventListener("click", async () => {
    const text = $("#pasteText").value.trim();
    if (text.length < 50) return toast("Paste the full resume text first.", "bad");
    const item = { id: uid(), name: $("#pasteName").value.trim() || "Pasted resume", createdAt: new Date().toISOString(), text, meta: { type: "txt", hasTables: false, hasImages: false, multiColumn: false, pages: null, textLength: text.length }, structured: null, source: "paste" };
    items.unshift(item);
    if (!S.resumes.activeId) S.resumes.activeId = item.id;
    S.ui.resumeSel = item.id;
    await save("resumes", true);
    rerender();
    if (S.status.hasAnthropicKey) structureResume(item);
  });
  main.addEventListener("change", (e) => {
    if (e.target.name === "activeRes") { S.resumes.activeId = e.target.value; save("resumes"); toast("Active resume set"); rerender(); }
  });
  main.addEventListener("click", (e) => {
    const o = e.target.closest("[data-open]");
    if (o) { S.ui.resumeSel = o.dataset.open; S.ui.resumeTab = null; rerender(); }
  });
  if (sel) bindResumeDetail(main, sel);
});

function resumeDetailHTML(r) {
  const tab = S.ui.resumeTab || (r.structured ? "preview" : "text");
  const m = r.meta || {};
  const warn = [m.hasTables && "tables", m.hasImages && "images", m.multiColumn && "multiple columns"].filter(Boolean);
  return `<div class="card"><div class="card-head"><input type="text" id="resName" value="${esc(r.name)}" aria-label="Version name" style="font-weight:700;max-width:360px"><span class="spacer"></span>
      <button class="btn small" id="resDup">Duplicate</button><button class="btn small ghost danger" id="resDel">Delete</button></div>
    <div class="row small muted" style="margin-bottom:10px">${m.type ? `<span class="badge">${esc(m.type.toUpperCase())}</span>` : ""}${m.pages ? `<span>${m.pages} page${m.pages > 1 ? "s" : ""}</span>` : ""}<span>${(r.text || "").split(/\s+/).filter(Boolean).length} words</span>
      ${warn.length ? `<span class="badge warn">has ${warn.join(", ")}</span>` : ""}<a href="#/ats" class="small">ATS check →</a></div>
    ${(m.warnings || []).map((w) => `<div class="notice warn small" style="margin-bottom:8px">${esc(w)}</div>`).join("")}
    ${!r.structured ? `<div class="notice info" style="margin-bottom:10px"><div class="grow">To use templates, the format lock and tailoring, Claude reads this resume into sections (wording copied exactly, nothing improved).</div><button class="btn small primary" id="resStructure"><span class="ai-dot"></span>Structure it</button></div>${slotHTML("structure")}` : ""}
    <div class="tabs" role="tablist">${[["preview", "Preview & export", !!r.structured], ["edit", "Edit", true], ["text", "Plain text", true]].filter((x) => x[2]).map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-rtab="${k}">${l}</button>`).join("")}</div>
    <div id="resTab">
      ${tab === "preview" && r.structured ? `${r.structured.format ? `<p class="small muted">Detected format: ${esc(r.structured.format.headingCase)} headings · bullet “${esc(r.structured.format.bulletChar)}” · ${esc(r.structured.format.dateStyle)} · ${esc(r.structured.format.itemLayout)}</p>` : ""}${resumeExportBar("res")}` : ""}
      ${tab === "edit" ? (r.structured ? `<div id="resEditor">${structuredEditorHTML(r.structured)}</div><p class="small muted" style="margin-top:8px">Changes save automatically.</p>` : `<div class="field"><label>Resume text</label><textarea id="resText" class="xtall">${esc(r.text)}</textarea></div>`) : ""}
      ${tab === "text" ? `<div class="row" style="margin-bottom:8px"><button class="btn small" data-copy-from="#plainText">Copy</button><button class="btn small" id="dlTxt">Download .txt</button></div><textarea id="plainText" class="xtall mono" readonly>${esc(r.structured ? toText(r.structured) : r.text)}</textarea>` : ""}
    </div></div>`;
}

function bindResumeDetail(main, r) {
  $("#resName").addEventListener("input", (e) => { r.name = e.target.value; save("resumes"); });
  $("#resDel").addEventListener("click", () => {
    if (!confirm(`Delete “${r.name}”? This can't be undone.`)) return;
    S.resumes.items = S.resumes.items.filter((x) => x.id !== r.id);
    if (S.resumes.activeId === r.id) S.resumes.activeId = S.resumes.items[0]?.id || null;
    S.ui.resumeSel = null;
    save("resumes");
    rerender();
  });
  $("#resDup").addEventListener("click", () => {
    const c = { ...clone(r), id: uid(), name: `${r.name} (copy)`, createdAt: new Date().toISOString() };
    S.resumes.items.unshift(c);
    S.ui.resumeSel = c.id;
    save("resumes");
    rerender();
  });
  $("#resStructure")?.addEventListener("click", () => structureResume(r));
  $$("[data-rtab]", main).forEach((b) => b.addEventListener("click", () => { S.ui.resumeTab = b.dataset.rtab; rerender(); }));
  if (r.structured) bindResumeExport(main, "res", () => r.structured);
  const ed = $("#resEditor");
  if (ed) bindStructuredEditor(ed, r.structured, () => { if (r.source === "tailored") r.text = toText(r.structured); save("resumes"); }, rerender);
  $("#resText")?.addEventListener("input", (e) => { r.text = e.target.value; save("resumes"); });
  $("#dlTxt")?.addEventListener("click", () => download(`${fileSafe(r.name)}.txt`, r.structured ? toText(r.structured) : r.text));
}

// ================= ATS =================
async function atsFor(r, job = S.ui.job, extra = S.ui.extraKeywords || []) {
  return api("POST", "/api/ats", {
    resumeText: r.structured && r.source === "tailored" ? toText(r.structured) : r.text || toText(r.structured),
    jobText: job?.description || "", jobTitle: job?.title || "", fileMeta: r.meta || {}, extraKeywords: extra,
  });
}

function atsCompactHTML(rep) {
  const k = rep.keyword;
  return `<div class="row" style="align-items:flex-start;flex-wrap:nowrap">${scoreRing(rep.overall)}<div class="grow">
    <b>ATS score ${rep.overall}/100</b><div class="small muted">${k ? `Keyword match ${k.score}% · ` : ""}${rep.issues.filter((i) => i.severity === "high").length} high-priority issue(s)</div>
    ${k ? `<div class="chips" style="margin-top:8px">${k.matched.slice(0, 12).map((x) => `<span class="chip good">${esc(x)}</span>`).join("")}${k.missing.slice(0, 12).map((x) => `<span class="chip bad">${esc(x)}</span>`).join("")}</div>` : `<div class="small muted" style="margin-top:6px">Add a job description for keyword matching.</div>`}
    <a class="small" href="#/ats">Full ATS report →</a></div></div>`;
}

function atsReportHTML(rep) {
  const k = rep.keyword;
  const part = (l, v) => `<div>${esc(l)}</div><div class="row" style="flex-wrap:nowrap"><div class="meter grow"><span style="width:${v}%;background:${v >= 75 ? "var(--good)" : v >= 50 ? "var(--accent)" : "var(--warn)"}"></span></div><b style="width:2.5em;text-align:right">${v}</b></div>`;
  const yes = (b) => (b ? '<span class="badge good">yes</span>' : '<span class="badge bad">missing</span>');
  return `<div class="grid cols-2">
    <div class="card"><div class="row" style="flex-wrap:nowrap">${scoreRing(rep.overall)}<div><h2 style="margin:0">ATS score</h2><p class="small muted" style="margin:0">${k ? "Half format/content, half keyword match with this job." : "Format and content only. Add a job for keyword matching."}</p></div></div>
      <div class="kv" style="margin-top:14px">${part("Parsing", rep.parts.parsing)}${part("Sections", rep.parts.sections)}${part("Contact", rep.parts.contact)}${part("Writing", rep.parts.writing)}${k ? part("Keywords", k.score) : ""}</div></div>
    <div class="card"><h2>Contact & sections</h2><div class="kv">
      <div>Email</div><div>${yes(rep.contact.email)}</div><div>Phone</div><div>${yes(rep.contact.phone)}</div><div>Portfolio / reel</div><div>${yes(rep.contact.portfolio)}</div><div>LinkedIn</div><div>${yes(rep.contact.linkedin)}</div>
      ${Object.entries(rep.headings).map(([h, v]) => `<div>“${h[0].toUpperCase() + h.slice(1)}” heading</div><div>${yes(v)}</div>`).join("")}</div>
      <p class="small muted" style="margin-top:10px">${rep.stats.words} words · ${rep.stats.bullets} bullets · ${rep.stats.quantified} with numbers · ${rep.stats.actionStart} start with an action verb</p></div>
  </div>
  ${k ? `<div class="card" style="margin-top:14px"><h2>Keywords from the job</h2>
    <div class="grid cols-2"><div><h4>In your resume (${k.matched.length})</h4><div class="chips">${k.matched.map((x) => `<span class="chip good">${esc(x)}</span>`).join("") || '<span class="muted small">None</span>'}</div></div>
    <div><h4>Missing (${k.missing.length})</h4><div class="chips">${k.missing.map((x) => `<span class="chip bad">${esc(x)}</span>`).join("") || '<span class="muted small">None</span>'}</div><p class="small muted" style="margin-top:6px">Only add the ones that are true for you.</p></div></div>
    <p class="small" style="margin-top:10px">${k.requiredYears ? `Job asks for <b>${k.requiredYears}+ years</b>; your dates span about <b>${k.estimatedYears ?? "?"}</b>. ` : ""}${k.titleMatch === false ? "The job title isn't on your resume." : k.titleMatch ? "The job title appears on your resume." : ""}</p></div>` : ""}
  <div class="card" style="margin-top:14px"><h2>Issues to fix (${rep.issues.length})</h2>
    ${rep.issues.length ? `<ul class="list">${rep.issues.map((i) => `<li class="issue">${sevBadge(i.severity)}<div><b>${esc(i.area)}:</b> ${esc(i.message)}</div><div class="fix">${esc(i.fix)}</div></li>`).join("")}</ul>` : `<p class="muted">No issues found.</p>`}</div>
  <div class="grid cols-2" style="margin-top:14px">
    <div class="card"><h2>Skills found</h2><div class="chips">${rep.stats.skillsFound.map((x) => `<span class="chip">${esc(x)}</span>`).join("") || '<span class="muted small">None recognized</span>'}</div>
      ${rep.aiTells?.length ? `<h4 style="margin-top:14px">Generic / AI-sounding phrases</h4><div class="chips">${rep.aiTells.map((x) => `<span class="chip bad">${esc(x)}</span>`).join("")}</div>` : ""}</div>
    <div class="card"><h2>ATS tips</h2>${list(rep.tips)}</div>
  </div>`;
}

view("ats", "ATS Check", (main) => {
  const r = pickedResume();
  main.innerHTML = `${pageHead("ATS check", "How applicant tracking systems will read your resume: parsing risks, headings, contact links, keywords, and writing. Instant and free; no AI needed.")}
  <div class="split">
    <div class="stack">
      <div class="card"><h2>Resume</h2>${resumePickerHTML()}
        <div class="field"><label>Or check a file without saving it</label><input type="file" id="atsFile" accept=".pdf,.docx,.txt"></div>
        ${S.ui.atsFile ? `<div class="notice info small"><div class="grow">Checking file <b>${esc(S.ui.atsFile.meta.name)}</b></div><button class="btn small ghost" id="atsFileClear">Use saved resume</button></div>` : ""}
      </div>
      <div class="card"><h2>Job <span class="hint">optional</span></h2>${jobPickerHTML("ats", { compact: true })}
        <div class="row"><button class="btn primary" id="atsRun">Run check</button><button class="btn" id="atsExtract"><span class="ai-dot"></span>Sharpen keywords with AI</button></div>
        ${S.ui.extraKeywords?.length ? `<p class="small muted" style="margin-top:8px">Using ${S.ui.extraKeywords.length} AI-extracted keywords. <a href="#" id="clearExtra">Clear</a></p>` : ""}
        ${slotHTML("extract")}
      </div>
    </div>
    <div id="atsOut">${r || S.ui.atsFile ? '<div class="loading"><div class="spinner"></div>Checking…</div>' : '<div class="card empty">Add a resume first.</div>'}</div>
  </div>`;
  const run = async () => {
    const res = S.ui.atsFile ? { text: S.ui.atsFile.text, meta: S.ui.atsFile.meta } : pickedResume();
    if (!res) return;
    try {
      const rep = await atsFor(res);
      $("#atsOut").innerHTML = atsReportHTML(rep);
    } catch (e) {
      $("#atsOut").innerHTML = errorHTML(e);
    }
  };
  bindResumePicker(main, () => { S.ui.atsFile = null; run(); });
  bindJobPicker(main, debounce(run, 600));
  $("#atsRun").addEventListener("click", run);
  $("#atsFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const parsed = await api("POST", "/api/parse", { name: f.name, mime: f.type, data: await readFileAsBase64(f) });
      S.ui.atsFile = parsed;
      rerender();
    } catch (err) { toast(err.message, "bad"); }
  });
  $("#atsFileClear")?.addEventListener("click", () => { S.ui.atsFile = null; rerender(); });
  $("#clearExtra")?.addEventListener("click", (e) => { e.preventDefault(); S.ui.extraKeywords = []; rerender(); });
  $("#atsExtract").addEventListener("click", () => {
    if (!hasJob()) return toast("Paste a job description first.", "bad");
    runAI("extract", "extractJob", { jobText: jobForAI() }, {
      label: "Pulling the exact keywords from the posting…", expect: 30,
      onDone: (x) => { S.ui.extraKeywords = [...new Set([...(x.data.keywords || []), ...(x.data.tools || [])])]; S.ui.jobInfo = x.data; if (currentRoute().id === "ats") rerender(); },
    });
  });
  run();
});
slots.extract = { render: (r) => `<div class="small muted" style="margin-top:8px">${esc(r.data.summary || "")} ${r.data.employmentType ? `· ${esc(r.data.employmentType)}` : ""} ${r.data.workplace ? `· ${esc(r.data.workplace)}` : ""}</div>` };

// ================= Evaluate & Tailor =================
view("evaluate", "Evaluate & Tailor", (main) => {
  const t = S.ui.tailorOpts ||= { intensity: "balanced", keepLength: true, facts: "", notes: "" };
  main.innerHTML = `${pageHead("Evaluate & tailor", "Paste a job (or pick one from search). You get an instant ATS read, then Claude's honest evaluation, then a tailored version that keeps your resume's format.")}
  <div class="split">
    <div class="card"><h2>The job</h2>${jobPickerHTML("ev")}</div>
    <div class="stack">
      <div class="card"><h2>Your resume</h2>${resumePickerHTML()}<div id="evAts"></div></div>
      <div class="card"><h2>Evaluate</h2><p class="small muted">Fit score, what a recruiter sees in 6 seconds, strengths, gaps, and questions only you can answer.</p>
        <button class="btn primary" id="evRun"><span class="ai-dot"></span>Evaluate my fit</button></div>
    </div>
  </div>
  <div style="margin-top:14px">${slotHTML("evaluate")}</div>
  <div class="card" style="margin-top:14px"><div class="card-head"><h2>Tailor while keeping your format</h2></div>
    <div class="grid cols-2">
      <div><label>Intensity</label><div class="seg" role="radiogroup">${[["light", "Light"], ["balanced", "Balanced"], ["bold", "Bold"]].map(([v, l]) => `<label><input type="radio" name="intensity" value="${v}" ${t.intensity === v ? "checked" : ""}>${l}</label>`).join("")}</div>
        <p class="small muted" style="margin-top:6px">Light: swap in exact keywords, reorder. Balanced: rewrite weak bullets. Bold: rebuild around this job (still truthful).</p>
        <label class="check"><input type="checkbox" id="keepLen" ${t.keepLength ? "checked" : ""}>Keep the same length</label></div>
      <div><div class="field"><label>Extra facts <span class="hint">true things not on your resume; answers to Claude's questions go here too</span></label><textarea id="tFacts" style="min-height:80px">${esc(t.facts)}</textarea></div>
        <div class="field"><label>Instructions <span class="hint">optional</span></label><input type="text" id="tNotes" value="${esc(t.notes)}" placeholder="Lead with UI animation work"></div></div>
    </div>
    <div class="row"><button class="btn primary" id="tRun"><span class="ai-dot"></span>Tailor resume</button><span class="small muted">Titles, companies, dates and section order are locked to your original.</span></div>
    <div style="margin-top:12px">${slotHTML("structure")}${slotHTML("tailor")}</div>
  </div>`;

  const drawAts = async () => {
    const r = pickedResume();
    const box = $("#evAts");
    if (!r || !box) return;
    try { box.innerHTML = atsCompactHTML(await atsFor(r)); } catch (e) { box.innerHTML = errorHTML(e); }
  };
  bindJobPicker(main, debounce(drawAts, 600));
  bindResumePicker(main, drawAts);
  drawAts();
  $("#evRun").addEventListener("click", async () => {
    const r = pickedResume();
    if (!r) return toast("Add a resume first.", "bad");
    if (!hasJob()) return toast("Paste the job description first.", "bad");
    const ats = await atsFor(r).catch(() => null);
    S.ui.evalAnswers = [];
    runAI("evaluate", "evaluate", { resume: resumeForAI(r), job: jobForAI(), ats: ats && { overall: ats.overall, keyword: ats.keyword, issues: ats.issues.slice(0, 8) } }, { label: "Reading the job like a hiring manager would…", expect: 60 });
  });
  main.addEventListener("input", (e) => {
    if (e.target.id === "tFacts") t.facts = e.target.value;
    if (e.target.id === "tNotes") t.notes = e.target.value;
  });
  main.addEventListener("change", (e) => {
    if (e.target.name === "intensity") t.intensity = e.target.value;
    if (e.target.id === "keepLen") t.keepLength = e.target.checked;
  });
  $("#tRun").addEventListener("click", async () => {
    const r = pickedResume();
    if (!r) return toast("Add a resume first.", "bad");
    if (!hasJob()) return toast("Paste the job description first.", "bad");
    if (!S.status.hasAnthropicKey) return runAI("tailor", "tailor", {});
    if (!r.structured) {
      await runAI("structure", "structureResume", { text: r.text }, { label: "Step 1 of 2: reading your resume's structure…", expect: 40, onDone: (x) => { r.structured = x.data; save("resumes"); } });
      if (!r.structured) return;
    }
    const answers = [t.facts, ...(S.ui.evalAnswers || []).filter((a) => a?.a?.trim()).map((a) => `Q: ${a.q}\nA: ${a.a}`)].filter(Boolean).join("\n\n");
    const job = clone(S.ui.job);
    const original = clone(r.structured);
    runAI("tailor", "tailor", { resume: resumeForAI(r), job: jobForAI(job), options: { intensity: t.intensity, keepLength: t.keepLength, answers, notes: t.notes } }, {
      label: `${r.structured ? "" : "Step 2 of 2: "}Tailoring “${r.name}” to ${job.title || "this job"}… (this is the longest step)`, expect: 90,
      onDone: (x) => { S.ui.tailorBase = { resumeId: r.id, resumeName: r.name, original, job }; S.ui.tailorChanges = computeChanges(original, x.data.resume); },
    });
  });
});

slots.evaluate = {
  render: (r) => {
    const d = r.data;
    const vClass = /Strong|Good/.test(d.verdict) ? "good" : /Stretch/.test(d.verdict) ? "warn" : "bad";
    return `<div class="card"><div class="row" style="flex-wrap:nowrap;align-items:flex-start">${scoreRing(Math.round(d.fitScore))}<div class="grow">
      <div class="row"><span class="badge ${vClass}">${esc(d.verdict)}</span><span class="badge accent">${esc(d.recommendation)}</span></div>
      <p style="margin:8px 0 0;font-size:1.05rem" contenteditable="true">${esc(d.headline)}</p></div></div>
      <hr><h4>What a recruiter sees in 6 seconds</h4><p contenteditable="true">${esc(d.recruiterSixSeconds)}</p>
      <div class="grid cols-2"><div><h4>Strengths</h4><ul class="list">${d.strengths.map((s) => `<li><b contenteditable="true">${esc(s.point)}</b><div class="small muted" contenteditable="true">${esc(s.evidence)}</div></li>`).join("")}</ul></div>
      <div><h4>Gaps</h4><ul class="list">${d.gaps.map((g) => `<li><div class="row">${sevBadge(g.severity)}<b class="grow">${esc(g.requirement)}</b></div><div class="small muted">${esc(g.status)}</div><div class="small" contenteditable="true">${esc(g.suggestion)}</div></li>`).join("") || '<li class="muted">No major gaps.</li>'}</ul></div></div>
      <hr><h4>Section by section</h4><ul class="list">${d.sectionFeedback.map((s) => `<li><b>${esc(s.section)}:</b> <span contenteditable="true">${esc(s.feedback)}</span></li>`).join("")}</ul>
      <hr><h4>Portfolio / reel</h4><p contenteditable="true">${esc(d.portfolioAdvice)}</p>
      ${d.questionsForYou?.length ? `<hr><h4>Questions only you can answer</h4><p class="small muted">Your answers are passed to tailoring as true facts. Skip any you'd rather not answer.</p>
        ${d.questionsForYou.map((q, i) => `<div class="field"><label>${esc(q)}</label><textarea data-ans="${i}" style="min-height:56px">${esc(S.ui.evalAnswers?.[i]?.a || "")}</textarea></div>`).join("")}` : ""}
      <div class="row end"><button class="btn small" id="evSave">Save evaluation</button></div></div>`;
  },
  bind: (el, r) => {
    S.ui.evalAnswers ||= [];
    el.addEventListener("input", (e) => {
      const i = e.target.dataset.ans;
      if (i != null) S.ui.evalAnswers[i] = { q: r.data.questionsForYou[i], a: e.target.value };
    });
    $("#evSave", el)?.addEventListener("click", () => saveDocument("evaluation", `Evaluation: ${S.ui.job.title || "job"} @ ${S.ui.job.company || ""}`, { ...r.data, edited: el.innerText }));
  },
};

// --- Tailoring diff ---
function sim(a, b) {
  const A = new Set(String(a).toLowerCase().match(/[a-z0-9+#]+/g) || []), B = new Set(String(b).toLowerCase().match(/[a-z0-9+#]+/g) || []);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}

function computeChanges(orig, tail) {
  const ch = [];
  const add = (c) => ch.push({ id: ch.length, accepted: true, edited: null, ...c });
  if ((orig.contact?.headline || "") !== (tail.contact?.headline || "")) add({ kind: "field", field: "headline", label: "Headline", before: orig.contact?.headline || "", after: tail.contact?.headline || "" });
  (tail.sections || []).forEach((ts, i) => {
    const os = orig.sections?.[i] || { items: [] };
    if ((os.text || "") !== (ts.text || "")) add({ kind: "field", field: "text", i, label: `${ts.heading}`, before: os.text || "", after: ts.text || "" });
    const oi = os.items || [], ti = ts.items || [];
    if (oi.length !== ti.length) { add({ kind: "items", i, label: `${ts.heading} · whole section`, before: oi, after: ti }); return; }
    ti.forEach((it, j) => {
      const o = oi[j];
      const name = `${ts.heading} · ${it.title || it.organization || `item ${j + 1}`}`;
      if ((o.details || "") !== (it.details || "")) add({ kind: "field", field: "details", i, j, label: `${name} · details`, before: o.details || "", after: it.details || "" });
      const ob = o.bullets || [], tb = it.bullets || [];
      const used = new Set();
      tb.forEach((b, k) => {
        let best = -1, bs = 0;
        ob.forEach((x, m) => { if (used.has(m)) return; const s = x === b ? 2 : sim(x, b); if (s > bs) { bs = s; best = m; } });
        if (bs < 0.2) best = -1;
        if (best >= 0) used.add(best);
        const before = best >= 0 ? ob[best] : "";
        if (before !== b) add({ kind: "bullet", i, j, k, label: `${name} · ${before ? "bullet" : "new bullet"}`, before, after: b });
      });
      ob.forEach((x, m) => { if (!used.has(m)) add({ kind: "removed", i, j, label: `${name} · removed bullet`, before: x, after: "" }); });
    });
  });
  return ch;
}

function applyChanges(tail, changes) {
  const out = clone(tail);
  const val = (c) => (c.accepted ? c.edited ?? c.after : c.before);
  for (const c of changes) {
    if (c.kind === "field") {
      if (c.field === "headline") out.contact.headline = val(c);
      else if (c.j == null) out.sections[c.i].text = val(c);
      else out.sections[c.i].items[c.j][c.field] = val(c);
    }
    if (c.kind === "items" && !c.accepted) out.sections[c.i].items = clone(c.before);
  }
  out.sections.forEach((s, i) => (s.items || []).forEach((it, j) => {
    const bc = changes.filter((c) => c.kind === "bullet" && c.i === i && c.j === j);
    const rm = changes.filter((c) => c.kind === "removed" && c.i === i && c.j === j);
    if (!bc.length && !rm.length) return;
    const nb = [];
    (tail.sections[i].items[j].bullets || []).forEach((b, k) => {
      const c = bc.find((x) => x.k === k);
      const v = c ? val(c) : b;
      if (v && v.trim()) nb.push(v.trim());
    });
    rm.filter((c) => !c.accepted).forEach((c) => nb.push(c.before));
    it.bullets = nb;
  }));
  return out;
}

const itemsText = (items) => (items || []).map((it) => [[it.title, it.organization, it.dates].filter(Boolean).join(" | "), ...(it.bullets || []).map((b) => `- ${b}`)].join("\n")).join("\n\n");

function changeHTML(c) {
  const st = c.accepted ? "" : "rejected";
  let body;
  if (c.kind === "items") body = `<div class="grid cols-2"><div><h4>Before</h4><div class="out-block small">${esc(itemsText(c.before))}</div></div><div><h4>After</h4><div class="out-block small">${esc(itemsText(c.after))}</div></div></div>`;
  else if (c.kind === "removed") body = `<div class="text"><del>${esc(c.before)}</del></div>`;
  else body = `<div class="text">${c.before ? wordDiff(c.before, c.edited ?? c.after) : `<ins>${esc(c.edited ?? c.after)}</ins>`}</div>
    <details><summary class="small" style="cursor:pointer">Edit wording</summary><textarea data-edit="${c.id}" style="margin-top:6px">${esc(c.edited ?? c.after)}</textarea></details>`;
  const ph = placeholdersIn(c.edited ?? c.after);
  return `<div class="change ${st}" data-change="${c.id}"><div class="row"><span class="where grow">${esc(c.label)}</span>
    ${ph.length && c.accepted ? `<span class="badge info" title="Replace with a real number before using">fill in ${ph.length}</span>` : ""}
    <div class="seg" role="radiogroup" aria-label="Accept or reject"><label><input type="radio" name="ch-${c.id}" value="1" ${c.accepted ? "checked" : ""}>${c.kind === "removed" ? "Remove" : "Accept"}</label><label><input type="radio" name="ch-${c.id}" value="0" ${!c.accepted ? "checked" : ""}>${c.kind === "removed" ? "Keep" : "Reject"}</label></div></div>${body}</div>`;
}

slots.tailor = {
  render: (r) => {
    const d = r.data, base = S.ui.tailorBase || {}, changes = S.ui.tailorChanges || [];
    const fr = r.formatReport || { restored: [], warnings: [] };
    const delta = r.ats ? r.ats.after - r.ats.before : 0;
    return `<div class="grid cols-2">
      <div class="card" style="background:var(--surface-2)"><h3>What changed</h3><p contenteditable="true">${esc(d.summaryOfChanges)}</p>
        ${r.ats ? `<p><b>ATS score:</b> ${r.ats.before} → ${r.ats.after} <span class="badge ${delta >= 0 ? "good" : "bad"}">${delta >= 0 ? "+" : ""}${delta}</span></p>` : ""}
        <h4>Keywords added</h4><div class="chips">${d.keywordsAdded.map((k) => `<span class="chip good">${esc(k)}</span>`).join("") || '<span class="small muted">None</span>'}</div>
        ${d.keywordsNotAdded.length ? `<h4 style="margin-top:10px">Not added (and why)</h4><ul class="plain small">${d.keywordsNotAdded.map((k) => `<li><b>${esc(k.keyword)}</b>: ${esc(k.reason)}</li>`).join("")}</ul>` : ""}</div>
      <div class="card" style="background:var(--surface-2)"><h3>Format lock</h3>
        ${fr.restored.length || fr.warnings.length ? "" : `<p class="small">Your format came back intact: same sections, titles, companies and dates.</p>`}
        ${fr.warnings.map((w) => `<div class="notice warn small" style="margin-bottom:6px">${esc(w)}</div>`).join("")}
        ${fr.restored.length ? `<details><summary class="small" style="cursor:pointer">${fr.restored.length} thing(s) restored to your original</summary><ul class="plain small">${fr.restored.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}
        ${d.placeholdersToFill.length ? `<h4 style="margin-top:10px">Fill these in with real numbers</h4><div class="chips">${d.placeholdersToFill.map((p) => `<span class="chip">${esc(p)}</span>`).join("")}</div>` : ""}</div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h3>Review changes (${changes.length})</h3><span class="spacer"></span><button class="btn small" data-all="1">Accept all</button><button class="btn small" data-all="0">Reject all</button></div>
      ${changes.length ? changes.map(changeHTML).join("") : `<p class="muted">No wording changes.</p>`}
      ${d.changes?.length ? `<details style="margin-top:10px"><summary class="small" style="cursor:pointer">Claude's reasons for each change</summary><ul class="list small">${d.changes.map((c) => `<li><b>${esc(c.where)}</b>: ${esc(c.why)}</li>`).join("")}</ul></details>` : ""}
    </div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h3>Result</h3><span class="spacer"></span><button class="btn primary" id="tSave">Save as new version</button></div>
      <p class="small muted">Tailored from “${esc(base.resumeName || "")}” for ${esc(base.job?.title || "this job")}${base.job?.company ? ` at ${esc(base.job.company)}` : ""}.</p>
      ${resumeExportBar("tail")}</div>`;
  },
  bind: (el, r) => {
    const changes = S.ui.tailorChanges || [];
    const final = () => applyChanges(r.data.resume, changes);
    const redrawPreview = () => $("[data-export='tail'] input:checked", el)?.dispatchEvent(new Event("change", { bubbles: true }));
    el.addEventListener("change", (e) => {
      const m = e.target.name?.match(/^ch-(\d+)$/);
      if (!m) return;
      const c = changes[+m[1]];
      c.accepted = e.target.value === "1";
      e.target.closest(".change").outerHTML = changeHTML(c);
      redrawPreview();
    });
    el.addEventListener("input", debounce((e) => {
      const id = e.target.dataset.edit;
      if (id == null) return;
      changes[+id].edited = e.target.value;
      const box = e.target.closest(".change");
      $(".text", box).innerHTML = changes[+id].before ? wordDiff(changes[+id].before, e.target.value) : `<ins>${esc(e.target.value)}</ins>`;
      redrawPreview();
    }, 250));
    el.addEventListener("click", (e) => {
      const all = e.target.closest("[data-all]");
      if (!all) return;
      changes.forEach((c) => (c.accepted = all.dataset.all === "1"));
      refreshSlot("tailor");
    });
    bindResumeExport(el, "tail", final);
    $("#tSave", el).addEventListener("click", () => {
      const res = final();
      const left = placeholdersIn(toText(res));
      if (left.length && !confirm(`${left.length} placeholder(s) like ${left[0]} still need real numbers. Save anyway? (You can edit the new version in Resumes.)`)) return;
      const base = S.ui.tailorBase || {};
      const item = { id: uid(), name: `${base.resumeName || "Resume"} → ${base.job?.company || base.job?.title || "tailored"}`, createdAt: new Date().toISOString(), text: toText(res), structured: res, meta: { type: "tailored" }, source: "tailored", parentId: base.resumeId, job: { title: base.job?.title, company: base.job?.company } };
      S.resumes.items.unshift(item);
      save("resumes");
      S.ui.resumeSel = item.id;
      toast("Saved as a new version");
      if (confirm("Saved. Open it in Resumes?")) go("resumes");
    });
  },
};

// ================= Jobs =================
const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Contract-to-hire", "Freelance", "Internship", "Temporary", "Unspecified"];
const jobIndex = new Map();
S.ui.verify = {};

function searchDefaults() {
  const f = activeFocus();
  const src = (S.status.sources || []).filter((s) => s.active && s.id !== "web").map((s) => s.id);
  return { queries: (f.roles || []).slice(0, 3).join(", "), location: "", remoteOnly: false, maxAgeDays: 14, types: [], sources: src };
}

async function runSearch() {
  const f = S.ui.searchForm;
  const key = "jobs";
  if (S.pending[key]) return;
  const ctrl = new AbortController();
  const web = f.sources.includes("web");
  S.pending[key] = { label: web ? "Searching job boards, plus Claude searching studio sites and niche boards…" : "Searching job boards…", expect: web ? 90 : 20, t0: Date.now(), ctrl };
  delete S.errors[key];
  refreshSlot(key);
  updateNavBusy();
  try {
    const r = await api("POST", "/api/jobs/search", { queries: csv(f.queries), location: f.location, remoteOnly: f.remoteOnly, maxAgeDays: Number(f.maxAgeDays), types: f.types, sources: f.sources }, { signal: ctrl.signal });
    r.at = new Date().toISOString();
    S.results.jobs = r;
    S.ui.lastSearch = { at: r.at, jobs: r.jobs.slice(0, 120).map((j) => ({ ...j, description: j.description.slice(0, 1500) })) };
    ls.set("lastSearch", S.ui.lastSearch);
  } catch (e) {
    if (e.name !== "AbortError") S.errors[key] = e;
  } finally {
    delete S.pending[key];
    refreshSlot(key);
    updateNavBusy();
  }
}

const isSaved = (id) => S.savedJobs.items.some((j) => j.id === id);

function jobCardHTML(j) {
  jobIndex.set(j.id, j);
  const v = S.ui.verify[j.url];
  const vBadge = v ? `<span class="badge ${v.status === "open" ? "good" : v.status === "closed" || v.status === "likely-closed" ? "bad" : ""}" title="${esc(v.reason)}">${v.status === "open" ? "Still open" : v.status === "closed" ? "Closed" : v.status === "likely-closed" ? "Likely closed" : v.status === "checking" ? "Checking…" : "Couldn't verify"}</span>` : "";
  const typeClass = /Contract|Freelance|Temporary/.test(j.type) ? "warn" : j.type === "Full-time" ? "good" : "";
  return `<article class="card job" data-job="${esc(j.id)}">
    <div><h3><a href="${esc(j.applyUrl || j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a></h3>
      <div class="meta"><b>${esc(j.company)}</b><span>${esc(j.location || "")}</span>${j.salary ? `<span>${esc(j.salary)}</span>` : ""}<span>${j.postedAt ? ago(j.postedAt) : esc(j.postedText || "date unknown")}</span></div>
      <div class="row" style="margin-top:6px;gap:6px"><span class="badge ${typeClass}">${esc(j.type)}</span>${j.remote ? '<span class="badge info">Remote</span>' : ""}<span class="badge">${esc(j.source)}${j.via ? ` · ${esc(j.via)}` : ""}</span>${(j.alsoOn || []).length ? `<span class="badge" title="Also listed on">also on ${esc(j.alsoOn.join(", "))}</span>` : ""}${vBadge}</div>
    </div>
    <div class="side">${scoreRing(j.fit?.score ?? 0, true)}<span class="small muted">fit</span></div>
    <div class="full small">${(j.fit?.why || []).length ? `<span class="muted">Why: ${esc(j.fit.why.join(" · "))}</span>` : ""}${j.fit?.missingSkills?.length ? `<div class="muted">Skills they list that you haven't: ${esc(j.fit.missingSkills.slice(0, 6).join(", "))}</div>` : ""}</div>
    ${(j.flags || []).length ? `<div class="full">${j.flags.map((f) => `<div class="flag ${f.level}">${esc(f.text)}</div>`).join("")}</div>` : ""}
    <div class="full row" style="gap:6px">
      <button class="btn small ${isSaved(j.id) ? "" : "primary"}" data-ja="save">${isSaved(j.id) ? "Saved ✓" : "Save"}</button>
      <button class="btn small" data-ja="evaluate">Evaluate & tailor</button>
      <button class="btn small" data-ja="cover">Cover letter</button>
      <button class="btn small" data-ja="company">Company check</button>
      <button class="btn small" data-ja="network">Referrals</button>
      <button class="btn small" data-ja="track">Track</button>
      <button class="btn small ghost" data-ja="verify">Verify still open</button>
      <button class="btn small ghost" data-ja="desc" aria-expanded="false">Details</button>
    </div>
    <div class="full desc" hidden>${esc(j.description)}</div>
  </article>`;
}

function trackJob(j, status = "saved") {
  let t = S.tracker.items.find((x) => x.jobId === j.id || (x.url && x.url === (j.applyUrl || j.url)));
  if (!t) {
    t = { id: uid(), jobId: j.id, company: j.company, role: j.title, url: j.applyUrl || j.url, location: j.location, type: j.type, salary: j.salary, description: j.description, status, savedAt: today(), appliedAt: "", followUpAt: "", contacts: "", notes: "", resumeId: "", coverId: "", history: [{ status, at: new Date().toISOString() }] };
    S.tracker.items.unshift(t);
    save("tracker");
  }
  return t;
}

async function verifyJobs(js) {
  for (const j of js) S.ui.verify[j.url] = { status: "checking", reason: "" };
  redrawJobBadges(js);
  const urls = js.map((j) => j.url);
  try {
    const r = urls.length === 1 ? { results: { [urls[0]]: await api("POST", "/api/jobs/verify", { url: urls[0] }) } } : await api("POST", "/api/jobs/verify", { urls });
    Object.assign(S.ui.verify, r.results);
  } catch (e) {
    for (const u of urls) S.ui.verify[u] = { status: "unknown", reason: e.message };
  }
  redrawJobBadges(js);
}
function redrawJobBadges(js) {
  for (const j of js) {
    const el = document.querySelector(`[data-job="${CSS.escape(j.id)}"]`);
    if (el) {
      const open = !$(".desc", el).hidden;
      el.outerHTML = jobCardHTML(j);
      if (open) { const n = document.querySelector(`[data-job="${CSS.escape(j.id)}"] .desc`); if (n) n.hidden = false; }
    }
  }
}

function bindJobActions(root) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ja]");
    if (!b) return;
    const card = b.closest("[data-job]");
    const j = jobIndex.get(card.dataset.job) || S.savedJobs.items.find((x) => x.id === card.dataset.job);
    if (!j) return;
    const a = b.dataset.ja;
    if (a === "desc") { const d = $(".desc", card); d.hidden = !d.hidden; b.setAttribute("aria-expanded", String(!d.hidden)); }
    if (a === "save") {
      if (isSaved(j.id)) S.savedJobs.items = S.savedJobs.items.filter((x) => x.id !== j.id);
      else S.savedJobs.items.unshift({ ...j, savedAt: new Date().toISOString() });
      save("savedJobs");
      redrawJobBadges([j]);
      if (S.ui.jobsTab === "saved") rerender();
    }
    if (a === "verify") verifyJobs([j]);
    if (a === "evaluate") { setWorkingJob(j); go("evaluate"); }
    if (a === "cover") { setWorkingJob(j); go("cover"); }
    if (a === "network") { setWorkingJob(j); go("networking"); }
    if (a === "company") go("companies", `c=${encodeURIComponent(j.company)}&role=${encodeURIComponent(j.title)}`);
    if (a === "track") { trackJob(j); toast("Added to tracker"); renderNav(); }
  });
}

function filteredJobs(all) {
  const f = S.ui.jf ||= { type: "", remote: "", source: "", minFit: 0, within: 0, text: "", sort: "fit" };
  let js = all.filter((j) => (!f.type || j.type === f.type) && (!f.remote || (f.remote === "remote" ? j.remote : !j.remote)) && (!f.source || j.source === f.source) && (j.fit?.score ?? 0) >= f.minFit && (!f.within || !j.postedAt || Date.now() - new Date(j.postedAt).getTime() <= f.within * 86400000));
  if (f.text) { const t = f.text.toLowerCase(); js = js.filter((j) => `${j.title} ${j.company} ${j.location} ${j.description}`.toLowerCase().includes(t)); }
  if (f.sort === "new") js = [...js].sort((a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
  return js;
}

view("jobs", "Jobs", (main, params) => {
  if (params.get("tab")) S.ui.jobsTab = params.get("tab");
  const f = S.ui.searchForm ||= searchDefaults();
  if (!S.results.jobs && S.ui.lastSearch) S.results.jobs = { ...S.ui.lastSearch, status: {}, dropped: {}, restored: true };
  const tab = S.ui.jobsTab;
  main.innerHTML = `${pageHead("Jobs", "Currently open postings from many boards. Expired and old postings are dropped, duplicates are merged, and each job shows its type, pay, fit and red flags.")}
  <div class="tabs" role="tablist"><button role="tab" aria-selected="${tab !== "saved"}" data-jt="results">Search</button><button role="tab" aria-selected="${tab === "saved"}" data-jt="saved">Saved (${S.savedJobs.items.length})</button></div>
  ${tab === "saved" ? `<div id="savedList">${S.savedJobs.items.length ? S.savedJobs.items.map(jobCardHTML).join("") : '<div class="card empty">No saved jobs yet.</div>'}</div>` : `
  <form class="card" id="searchForm">
    <div class="grid cols-3">
      <div class="field" style="grid-column:span 2"><label>Search for <span class="hint">comma-separated; from your active focus</span></label><input type="text" name="queries" value="${esc(f.queries)}"></div>
      <div class="field"><label>Location <span class="hint">optional</span></label><input type="text" name="location" value="${esc(f.location)}" placeholder="New York"></div>
    </div>
    <div class="row" style="margin-bottom:8px">
      <label class="check"><input type="checkbox" name="remoteOnly" ${f.remoteOnly ? "checked" : ""}>Remote only</label>
      <label class="check" style="font-weight:500">Posted within <select name="maxAgeDays" style="width:auto;min-height:32px;margin-left:6px">${[3, 7, 14, 30, 60].map((d) => `<option value="${d}" ${+f.maxAgeDays === d ? "selected" : ""}>${d} days</option>`).join("")}</select></label>
    </div>
    <details><summary class="small" style="cursor:pointer">Types and sources</summary>
      <div style="margin-top:10px"><label>Job types <span class="hint">none checked = all</span></label>${JOB_TYPES.filter((t) => t !== "Unspecified").map((t) => `<label class="check"><input type="checkbox" name="types" value="${t}" ${f.types.includes(t) ? "checked" : ""}>${t}</label>`).join("")}</div>
      <div style="margin-top:8px"><label>Sources</label>${(S.status.sources || []).map((s) => `<label class="check" title="${esc(s.note)}"><input type="checkbox" name="sources" value="${s.id}" ${f.sources.includes(s.id) ? "checked" : ""} ${s.active ? "" : "disabled"}>${esc(s.name)}${s.active ? "" : ' <span class="hint">(needs key)</span>'}${s.id === "web" && s.active ? ' <span class="hint">(uses API credit)</span>' : ""}</label>`).join("")}</div>
    </details>
    <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">Search</button><button class="btn ghost" type="button" id="resetSearch">Reset to focus</button></div>
  </form>
  <div style="margin-top:14px">${slotHTML("jobs")}</div>`}`;

  $$("[data-jt]", main).forEach((b) => b.addEventListener("click", () => { S.ui.jobsTab = b.dataset.jt; history.replaceState(null, "", "#/jobs"); rerender(); }));
  bindJobActions(main);
  const form = $("#searchForm");
  if (!form) return;
  form.addEventListener("change", () => {
    const fd = new FormData(form);
    Object.assign(f, { queries: fd.get("queries"), location: fd.get("location"), remoteOnly: !!fd.get("remoteOnly"), maxAgeDays: fd.get("maxAgeDays"), types: fd.getAll("types"), sources: fd.getAll("sources") });
  });
  form.addEventListener("input", (e) => { if (e.target.name === "queries" || e.target.name === "location") f[e.target.name] = e.target.value; });
  form.addEventListener("submit", (e) => { e.preventDefault(); form.dispatchEvent(new Event("change")); if (!f.sources.length) return toast("Pick at least one source.", "bad"); runSearch(); });
  $("#resetSearch").addEventListener("click", () => { S.ui.searchForm = searchDefaults(); rerender(); });
});

slots.jobs = {
  empty: () => `<div class="card empty">Search to see open jobs. Free sources work without any keys.</div>`,
  render: (r) => {
    const fl = S.ui.jf ||= { type: "", remote: "", source: "", minFit: 0, within: 0, text: "", sort: "fit" };
    const srcs = [...new Set(r.jobs.map((j) => j.source))];
    const st = Object.entries(r.status || {});
    return `<div class="card">
      <div class="row small" style="margin-bottom:8px"><b>${r.jobs.length} open jobs</b><span class="muted">${r.restored ? `from your last search (${ago(r.at)}). Search again for fresh results.` : `searched ${r.total ?? "?"} postings · dropped ${r.dropped?.stale || 0} old, ${r.dropped?.expired || 0} expired, ${r.dropped?.offTopic || 0} off-topic`}</span></div>
      ${st.length ? `<div class="chips" style="margin-bottom:10px">${st.map(([id, s]) => `<span class="chip ${s.ok ? "" : "bad"}" title="${esc(s.error || "")}">${esc((S.status.sources.find((x) => x.id === id) || {}).name || id)}: ${s.ok ? s.count : "failed"}</span>`).join("")}</div>` : ""}
      ${st.some(([, s]) => !s.ok) ? `<p class="small muted">Failed sources are usually temporary (site down or rate limit). Hover a red chip for the reason.</p>` : ""}
      <div class="grid cols-4" id="jobFilters">
        <div class="field"><label>Type</label><select data-f="type"><option value="">All types</option>${JOB_TYPES.map((t) => `<option ${fl.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="field"><label>Remote</label><select data-f="remote"><option value="">Any</option><option value="remote" ${fl.remote === "remote" ? "selected" : ""}>Remote</option><option value="onsite" ${fl.remote === "onsite" ? "selected" : ""}>On-site / hybrid</option></select></div>
        <div class="field"><label>Source</label><select data-f="source"><option value="">All sources</option>${srcs.map((s) => `<option ${fl.source === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
        <div class="field"><label>Posted within</label><select data-f="within"><option value="0">Any</option>${[1, 3, 7, 14, 30].map((d) => `<option value="${d}" ${+fl.within === d ? "selected" : ""}>${d} day${d > 1 ? "s" : ""}</option>`).join("")}</select></div>
        <div class="field"><label>Minimum fit: <span id="minFitV">${fl.minFit}</span></label><input type="range" min="0" max="90" step="5" value="${fl.minFit}" data-f="minFit" style="width:100%;accent-color:var(--accent)"></div>
        <div class="field"><label>Sort</label><select data-f="sort"><option value="fit">Best fit</option><option value="new" ${fl.sort === "new" ? "selected" : ""}>Newest</option></select></div>
        <div class="field" style="grid-column:span 2"><label>Filter text</label><input type="search" data-f="text" value="${esc(fl.text)}" placeholder="e.g. Rive, games, NYC"></div>
      </div>
      <div class="row"><span class="small muted" id="shownCount"></span><span class="grow"></span><button class="btn small" id="verifyAll">Verify all shown</button></div>
    </div><div id="jobList" style="margin-top:12px"></div>`;
  },
  bind: (el, r) => {
    const draw = () => {
      const js = filteredJobs(r.jobs);
      $("#shownCount", el).textContent = `Showing ${Math.min(js.length, 100)} of ${js.length}`;
      $("#jobList", el).innerHTML = js.length ? js.slice(0, 100).map(jobCardHTML).join("") : `<div class="card empty">No jobs match these filters.</div>`;
    };
    const fl = S.ui.jf;
    $("#jobFilters", el).addEventListener("input", (e) => {
      const k = e.target.dataset.f;
      if (!k) return;
      fl[k] = ["minFit", "within"].includes(k) ? Number(e.target.value) : e.target.value;
      if (k === "minFit") $("#minFitV", el).textContent = e.target.value;
      draw();
    });
    $("#verifyAll", el).addEventListener("click", () => {
      const js = filteredJobs(r.jobs).slice(0, 60);
      if (js.length > 20 && !confirm(`Check ${js.length} postings? It takes about ${Math.ceil(js.length / 6) * 3} seconds.`)) return;
      verifyJobs(js);
    });
    draw();
  },
};

// ================= Companies =================
view("companies", "Companies", (main, params) => {
  if (params.get("c")) { S.ui.company = params.get("c"); S.ui.companyRole = params.get("role") || ""; }
  const cached = Object.values(S.companies || {}).sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt));
  main.innerHTML = `${pageHead("Company check", "Before you apply: ratings from Glassdoor, Indeed and others (with links), how they treat contractors, pay, interview process, recent layoffs or news, and red flags. Claude searches the web; results are cached for 14 days.")}
  <div class="card"><div class="grid cols-3">
    <div class="field"><label>Company</label><input type="text" id="coName" value="${esc(S.ui.company || "")}" placeholder="e.g. Buck, Duolingo"></div>
    <div class="field"><label>Role <span class="hint">optional</span></label><input type="text" id="coRole" value="${esc(S.ui.companyRole || "")}"></div>
    <div class="field" style="align-self:end"><div class="row"><button class="btn primary" id="coRun"><span class="ai-dot"></span>Research</button><label class="check" style="margin:0"><input type="checkbox" id="coFresh">Ignore cache</label></div></div>
  </div></div>
  <div style="margin-top:14px">${slotHTML("company")}</div>
  ${cached.length ? `<div class="card" style="margin-top:14px"><h2>Researched before</h2><div class="chips">${cached.map((c) => `<button class="chip" data-co="${esc(c.data?.company || "")}">${esc(c.data?.company || "?")} <span class="faint">${ago(c.fetchedAt)}</span></button>`).join("")}</div></div>` : ""}`;
  const run = (refresh) => {
    const company = $("#coName").value.trim();
    if (!company) return toast("Enter a company name.", "bad");
    S.ui.company = company;
    S.ui.companyRole = $("#coRole").value.trim();
    runAI("company", "companyResearch", { company, role: S.ui.companyRole, refresh }, {
      label: `Researching ${company} across review sites and news…`, expect: 90,
      onDone: async () => { S.companies = (await api("GET", "/api/state/companies").catch(() => S.companies)) || {}; },
    });
  };
  $("#coRun").addEventListener("click", () => run($("#coFresh").checked));
  main.addEventListener("click", (e) => {
    const c = e.target.closest("[data-co]");
    if (!c) return;
    const hit = Object.values(S.companies).find((x) => x.data?.company === c.dataset.co);
    if (hit) { S.results.company = { ...hit, cached: true }; delete S.errors.company; $("#coName").value = c.dataset.co; refreshSlot("company"); }
  });
  if (params.get("c") && !S.results.company?.data?.company?.toLowerCase().includes(params.get("c").toLowerCase())) {
    const hit = Object.entries(S.companies).find(([k]) => k === params.get("c").toLowerCase().replace(/[^a-z0-9+#./ ]+/g, " ").replace(/\s+/g, " ").trim());
    if (hit) S.results.company = { ...hit[1], cached: true };
  }
});

slots.company = {
  render: (r) => {
    const d = r.data || {};
    if (d.raw) return `<div class="card"><p class="small muted">Claude's notes (couldn't be structured):</p><div class="out-block" contenteditable="true">${esc(d.raw)}</div>${sourcesHTML(r.sources)}</div>`;
    return `<div class="card"><div class="card-head"><h2>${esc(d.company)}</h2><span class="muted small">${esc([d.industry, d.size, d.headquarters].filter(Boolean).join(" · "))}</span><span class="spacer"></span><span class="badge">${r.cached ? `cached ${ago(r.fetchedAt)}` : "fresh"}</span></div>
      <p contenteditable="true">${esc(d.oneLiner)}</p>
      ${d.ratings?.length ? `<div class="table-wrap"><table><thead><tr><th>Source</th><th>Rating</th><th>Reviews</th></tr></thead><tbody>${d.ratings.map((x) => `<tr><td>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.source)}</a>` : esc(x.source)}</td><td><b>${esc(x.rating)}</b></td><td>${esc(x.reviews)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted small">No ratings found.</p>`}
      <div class="grid cols-2" style="margin-top:12px"><div><h4>Pros</h4>${editableList(d.pros)}</div><div><h4>Cons</h4>${editableList(d.cons)}</div></div>
      ${d.redFlags?.length ? `<h4 style="margin-top:12px">Red flags</h4>${d.redFlags.map((x) => `<div class="flag warn">${esc(x)}</div>`).join("")}` : ""}
      <div class="grid cols-2" style="margin-top:12px">
        <div><h4>Contractors & freelancers</h4><p contenteditable="true">${esc(d.contractorExperience)}</p></div>
        <div><h4>Pay</h4><p contenteditable="true">${esc(d.payInsights)}</p></div>
        <div><h4>Interview process</h4><p contenteditable="true">${esc(d.interviewProcess)}</p></div>
        <div><h4>Creative culture</h4><p contenteditable="true">${esc(d.creativeCulture)}</p></div>
      </div>
      ${d.recentNews?.length ? `<h4>Recent news</h4>${editableList(d.recentNews)}` : ""}
      <hr><h4>Verdict</h4><p contenteditable="true"><b>${esc(d.verdict)}</b></p>
      ${sourcesHTML(r.sources)}</div>`;
  },
};
function sourcesHTML(src) {
  return src?.length ? `<details style="margin-top:10px"><summary class="small" style="cursor:pointer">${src.length} sources</summary><ul class="plain small">${src.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></li>`).join("")}</ul></details>` : "";
}

// ================= Networking =================
const CHANNELS = [["LinkedIn connection note", 300], ["LinkedIn message", 1900], ["Email", 0], ["Instagram / X DM", 600], ["Slack / Discord DM", 600]];
const channelLimit = (ch) => (CHANNELS.find(([c]) => c === ch) || [0, 0])[1] || (/connection/i.test(ch) ? 300 : 0);

function searchLink(q) {
  const w = (q.where || "").toLowerCase();
  if (w.includes("google")) return `https://www.google.com/search?q=${encodeURIComponent(q.query)}`;
  if (w.includes("linkedin")) return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q.query)}`;
  return "";
}

view("networking", "Networking", (main) => {
  const tab = S.ui.netTab || "plan";
  const o = S.ui.outreach ||= { channel: "LinkedIn connection note", stage: "first contact", recipient: "", context: "", goal: "", company: "", jobTitle: "" };
  main.innerHTML = `${pageHead("Referrals & networking", "Warm intros beat cold applications. Claude plans who to reach and drafts short, generous messages in your voice. Nothing is ever sent for you.")}
  <div class="tabs" role="tablist"><button role="tab" aria-selected="${tab === "plan"}" data-nt="plan">Referral plan</button><button role="tab" aria-selected="${tab === "outreach"}" data-nt="outreach">Outreach messages</button></div>
  ${tab === "plan" ? `<div class="split"><div class="card"><h2>For which job?</h2>${jobPickerHTML("net", { compact: true })}
      <div class="field"><label>People you already know <span class="hint">schools, past employers, clients, communities</span></label><textarea id="netConn" placeholder="SCAD 2019; worked with Jen at Northwind; member of Motion Design Slack">${esc(S.ui.netConn || "")}</textarea></div>
      <button class="btn primary" id="planRun"><span class="ai-dot"></span>Build my referral plan</button></div>
    <div>${slotHTML("referral")}</div></div>` : `
    <div class="split"><div class="card"><h2>Message</h2>
      <div class="grid cols-2"><div class="field"><label>Channel</label><select id="oChannel">${CHANNELS.map(([c]) => `<option ${o.channel === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label>Stage</label><select id="oStage">${["first contact", "follow-up (no reply)", "ask for a referral (after rapport)", "thank-you after a chat", "thank-you after interview", "check in with a recruiter"].map((s) => `<option ${o.stage === s ? "selected" : ""}>${s}</option>`).join("")}</select></div></div>
      <div class="field"><label>Who</label><input type="text" id="oRecipient" value="${esc(o.recipient)}" placeholder="Sam Lee, Motion Lead at Duolingo"></div>
      <div class="field"><label>What you know about them <span class="hint">their work, a post, shared background</span></label><textarea id="oContext">${esc(o.context)}</textarea></div>
      <div class="field"><label>Your goal</label><input type="text" id="oGoal" value="${esc(o.goal)}" placeholder="a 15-minute chat about the team"></div>
      <div class="grid cols-2"><div class="field"><label>Company</label><input type="text" id="oCompany" value="${esc(o.company || S.ui.job.company)}"></div><div class="field"><label>Related job</label><input type="text" id="oJob" value="${esc(o.jobTitle || S.ui.job.title)}"></div></div>
      <button class="btn primary" id="oRun"><span class="ai-dot"></span>Draft 3 versions</button></div>
    <div>${slotHTML("outreach")}</div></div>`}`;
  $$("[data-nt]", main).forEach((b) => b.addEventListener("click", () => { S.ui.netTab = b.dataset.nt; rerender(); }));
  if (tab === "plan") {
    bindJobPicker(main);
    $("#netConn").addEventListener("input", (e) => (S.ui.netConn = e.target.value));
    $("#planRun").addEventListener("click", () => {
      if (!hasJob() && !S.ui.job.company) return toast("Add the job (or at least the company) first.", "bad");
      runAI("referral", "referralPlan", { job: jobForAI(), options: { connections: S.ui.netConn } }, { label: "Planning who to reach and how…", expect: 60 });
    });
  } else {
    const map = { oChannel: "channel", oStage: "stage", oRecipient: "recipient", oContext: "context", oGoal: "goal", oCompany: "company", oJob: "jobTitle" };
    main.addEventListener("input", (e) => { if (map[e.target.id]) o[map[e.target.id]] = e.target.value; });
    main.addEventListener("change", (e) => { if (map[e.target.id]) o[map[e.target.id]] = e.target.value; });
    $("#oRun").addEventListener("click", () => runAI("outreach", "outreach", { options: { ...o } }, { label: "Drafting messages in your voice…", expect: 30, onDone: () => (S.ui.outreachChannel = o.channel) }));
  }
});

slots.referral = {
  render: (r) => {
    const d = r.data;
    return `<div class="card"><p contenteditable="true">${esc(d.overview)}</p>
      <h4>Who to reach</h4><ul class="list">${d.targets.map((t) => `<li><b contenteditable="true">${esc(t.who)}</b><div class="small" contenteditable="true">${esc(t.why)}</div><div class="small muted" contenteditable="true">${esc(t.howToFind)}</div></li>`).join("")}</ul>
      <h4 style="margin-top:12px">Searches to run</h4><ul class="list">${d.searchQueries.map((q) => { const href = searchLink(q); return `<li><div class="row"><span class="badge">${esc(q.where)}</span><code class="mono grow" style="word-break:break-all">${esc(q.query)}</code><button class="btn small ghost" data-copy="${esc(q.query)}">Copy</button>${href ? `<a class="btn small" href="${esc(href)}" target="_blank" rel="noopener">Open</a>` : ""}</div><div class="small muted">${esc(q.purpose)}</div></li>`; }).join("")}</ul>
      <div class="grid cols-2" style="margin-top:12px"><div><h4>Communities</h4><ul class="plain">${d.communities.map((c) => `<li><b>${esc(c.name)}</b>: <span contenteditable="true">${esc(c.how)}</span></li>`).join("")}</ul></div><div><h4>Give first</h4>${editableList(d.giveFirst)}</div></div>
      <h4 style="margin-top:12px">Messages <span class="hint">edit before sending</span></h4>
      ${d.messages.map((m, i) => `<div class="field"><label>${esc(m.channel)} · <span class="hint">${esc(m.purpose)}</span></label>${counted(`id="refMsg${i}"`, m.text, channelLimit(m.channel))}<div class="row end"><button class="btn small" data-copy-from="#refMsg${i}">Copy</button></div></div>`).join("")}
      <div class="grid cols-2"><div><h4>Timeline</h4><ul class="list small">${d.timeline.map((t) => `<li><b>${esc(t.when)}</b>: <span contenteditable="true">${esc(t.action)}</span></li>`).join("")}</ul></div><div><h4>Avoid</h4>${editableList(d.avoid)}</div></div>
      <div class="row end"><button class="btn small" id="refSave">Save plan</button></div></div>`;
  },
  bind: (el, r) => {
    el.addEventListener("input", (e) => { const m = e.target.id?.match(/^refMsg(\d+)$/); if (m) r.data.messages[+m[1]].text = e.target.value; });
    $("#refSave", el).addEventListener("click", () => saveDocument("referral", `Referral plan: ${S.ui.job.company || S.ui.job.title}`, r.data));
  },
};

slots.outreach = {
  render: (r) => {
    const lim = channelLimit(S.ui.outreachChannel || "");
    return `<div class="card">${r.data.variants.map((v, i) => `<div class="field"><label>${esc(v.label)}</label>${counted(`id="outV${i}"`, v.text, lim)}
      <div class="row end"><span class="small muted grow" data-tells="${i}"></span><button class="btn small" data-copy-from="#outV${i}">Copy</button></div></div>`).join("")}
      ${r.data.tips?.length ? `<h4>Tips</h4>${list(r.data.tips)}` : ""}</div>`;
  },
  bind: (el, r) => {
    const tells = (i) => { const t = tellsIn($(`#outV${i}`, el).value); $(`[data-tells="${i}"]`, el).textContent = t.length ? `Sounds generic: ${t.join(", ")}` : ""; };
    r.data.variants.forEach((_, i) => tells(i));
    el.addEventListener("input", (e) => { const m = e.target.id?.match(/^outV(\d+)$/); if (m) { r.data.variants[+m[1]].text = e.target.value; tells(+m[1]); } });
  },
};

// ================= Cover letters =================
view("cover", "Cover Letters", (main) => {
  const o = S.ui.coverOpts ||= { tone: "warm and direct", length: "standard (250-350 words)", format: "letter", hook: "", recipient: "", notes: "" };
  const saved = S.documents.items.filter((d) => d.type === "cover");
  main.innerHTML = `${pageHead("Cover letters", "Specific, human letters built from your profile and real experience. Edit everything; generic phrases get highlighted.")}
  <div class="split"><div class="stack">
    <div class="card"><h2>Job</h2>${jobPickerHTML("cl", { compact: true })}${resumePickerHTML()}</div>
    <div class="card"><h2>Style</h2>
      <div class="grid cols-2">
        <div class="field"><label>Format</label><select data-co="format">${[["letter", "Classic letter"], ["email", "Email to a person"], ["portal", "Application text box"], ["dm", "Short DM"]].map(([v, l]) => `<option value="${v}" ${o.format === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label>Tone</label><select data-co="tone">${["warm and direct", "confident and concise", "enthusiastic but grounded", "formal", "playful (for studios with personality)"].map((t) => `<option ${o.tone === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="field"><label>Length</label><select data-co="length">${["short (150-200 words)", "standard (250-350 words)", "long (400-450 words)"].map((t) => `<option ${o.length === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="field"><label>To <span class="hint">optional</span></label><input type="text" data-co="recipient" value="${esc(o.recipient)}" placeholder="Sam Lee, Creative Director"></div>
      </div>
      <div class="field"><label>Why this job? <span class="hint">your hook: a project of theirs, a connection, a reason</span></label><textarea data-co="hook" style="min-height:70px">${esc(o.hook)}</textarea></div>
      <div class="field"><label>Anything else <span class="hint">optional</span></label><input type="text" data-co="notes" value="${esc(o.notes)}" placeholder="Mention I can start in January"></div>
      <button class="btn primary" id="clRun"><span class="ai-dot"></span>Write cover letter</button></div>
    ${saved.length ? `<div class="card"><h2>Saved letters</h2><ul class="list">${saved.map((d) => `<li class="row"><button class="btn ghost small grow" style="justify-content:flex-start" data-load="${esc(d.id)}">${esc(d.title)}</button><span class="small muted">${fmtDate(d.createdAt)}</span><button class="btn small ghost danger" data-del="${esc(d.id)}" aria-label="Delete">✕</button></li>`).join("")}</ul></div>` : ""}
  </div><div>${slotHTML("cover")}</div></div>`;
  bindJobPicker(main);
  bindResumePicker(main);
  main.addEventListener("input", (e) => { if (e.target.dataset.co) o[e.target.dataset.co] = e.target.value; });
  main.addEventListener("change", (e) => { if (e.target.dataset.co) o[e.target.dataset.co] = e.target.value; });
  $("#clRun").addEventListener("click", () => {
    if (!hasJob()) return toast("Paste the job description first.", "bad");
    S.ui.coverDocId = null;
    runAI("cover", "coverLetter", { resume: resumeForAI(pickedResume()), job: jobForAI(), options: { ...o } }, { label: "Writing your letter…", expect: 60 });
  });
  main.addEventListener("click", (e) => {
    const l = e.target.closest("[data-load]");
    const d = e.target.closest("[data-del]");
    if (l) { const doc = S.documents.items.find((x) => x.id === l.dataset.load); S.results.cover = { data: clone(doc.data) }; S.ui.coverDocId = doc.id; delete S.errors.cover; refreshSlot("cover"); }
    if (d && confirm("Delete this letter?")) { S.documents.items = S.documents.items.filter((x) => x.id !== d.dataset.del); save("documents"); rerender(); }
  });
});

function letterText(d, withHeader = false) {
  const p = S.profile;
  const head = withHeader ? [p.name, [p.location, ...(p.links || [])].filter(Boolean).join(" | "), "", new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }), ""].filter((x) => x != null) : [];
  return [...head, d.greeting, "", d.body, "", d.signoff].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

slots.cover = {
  empty: () => `<div class="card empty">Your letter will appear here, fully editable.</div>`,
  render: (r) => {
    const d = r.data;
    const tells = tellsIn(d.body);
    return `<div class="card">
      ${S.ui.coverOpts?.format === "email" || d.subject ? `<div class="field"><label>Subject</label><input type="text" data-cl="subject" value="${esc(d.subject)}"></div>` : ""}
      <div class="field"><label>Greeting</label><input type="text" data-cl="greeting" value="${esc(d.greeting)}"></div>
      <div class="field"><label>Body</label>${counted('data-cl="body" class="xtall"', d.body)}</div>
      <div class="field"><label>Sign-off</label><textarea data-cl="signoff" style="min-height:56px">${esc(d.signoff)}</textarea></div>
      <div class="row"><button class="btn" id="clHuman"><span class="ai-dot"></span>Make it sound more like me</button><span class="grow"></span>
        <button class="btn small" id="clCopy">Copy</button><button class="btn small" id="clDocx">DOCX</button><button class="btn small" id="clTxt">TXT</button><button class="btn small" id="clPrint">Print / PDF</button><button class="btn small primary" id="clSave">${S.ui.coverDocId ? "Update saved" : "Save"}</button></div>
      ${slotHTML("humanize")}
      <hr><h4>Check it</h4><p class="small muted" id="clTellsMsg">${tells.length ? `Generic or AI-sounding: <b>${esc(tells.join(", "))}</b>. Rewrite those in your own words.` : "No stock phrases found."} Bracketed bits are placeholders to fill in.</p>
      <div class="out-block" id="clPreview">${highlightTells(d.body)}</div>
      ${d.personalTouches?.length ? `<h4 style="margin-top:12px">Details from your profile <span class="hint">check these are right</span></h4>${list(d.personalTouches)}` : ""}
      ${d.placeholders?.length ? `<h4 style="margin-top:12px">Fill in</h4><div class="chips">${d.placeholders.map((p) => `<span class="chip">${esc(p)}</span>`).join("")}</div>` : ""}
    </div>`;
  },
  bind: (el, r) => {
    const d = r.data;
    el.addEventListener("input", (e) => {
      const k = e.target.dataset.cl;
      if (!k) return;
      d[k] = e.target.value;
      if (k === "body") {
        $("#clPreview", el).innerHTML = highlightTells(d.body);
        const t = tellsIn(d.body);
        $("#clTellsMsg", el).innerHTML = `${t.length ? `Generic or AI-sounding: <b>${esc(t.join(", "))}</b>. Rewrite those in your own words.` : "No stock phrases found."} Bracketed bits are placeholders to fill in.`;
      }
    });
    const name = () => fileSafe(`${S.profile.name || "Cover"}-Cover-Letter-${S.ui.job.company || ""}`);
    $("#clCopy", el).addEventListener("click", () => copyText(letterText(d)));
    $("#clTxt", el).addEventListener("click", () => download(`${name()}.txt`, letterText(d, true)));
    $("#clPrint", el).addEventListener("click", () => printHTML(`<div class="letter">${esc(letterText(d, S.ui.coverOpts?.format === "letter"))}</div>`));
    $("#clDocx", el).addEventListener("click", () => exportDocx({ kind: "cover", letter: { name: S.profile.name, contactLines: [S.profile.location, ...(S.profile.links || [])].filter(Boolean), recipient: S.ui.coverOpts?.recipient, subject: d.subject && S.ui.coverOpts?.format === "email" ? d.subject : "", greeting: d.greeting, body: d.body, signoff: d.signoff } }, `${name()}.docx`));
    $("#clSave", el).addEventListener("click", () => {
      const existing = S.documents.items.find((x) => x.id === S.ui.coverDocId);
      if (existing) { existing.data = clone(d); save("documents"); toast("Updated"); return; }
      const doc = saveDocument("cover", `${S.ui.job.title || "Cover letter"}${S.ui.job.company ? ` @ ${S.ui.job.company}` : ""}`, clone(d));
      S.ui.coverDocId = doc.id;
      const t = S.tracker.items.find((x) => x.company && x.company === S.ui.job.company && !x.coverId);
      if (t) { t.coverId = doc.id; save("tracker"); }
    });
    $("#clHuman", el).addEventListener("click", () => runAI("humanize", "humanize", { text: d.body, purpose: `cover letter (${S.ui.coverOpts?.format || "letter"})` }, {
      label: "Rewriting in your voice…", expect: 30,
      onDone: (x) => { d.previousBody = d.body; d.body = x.data.text; refreshSlot("cover"); },
    }));
  },
};
slots.humanize = {
  render: (r) => `<div class="notice good small" style="margin-top:10px"><div class="grow"><b>Rewritten in your voice.</b> ${r.data.notes?.length ? esc(r.data.notes.join(" · ")) : ""}</div>${S.results.cover?.data?.previousBody ? `<button class="btn small" id="undoHuman">Undo</button>` : ""}</div>`,
  bind: (el) => $("#undoHuman", el)?.addEventListener("click", () => { const d = S.results.cover.data; d.body = d.previousBody; delete d.previousBody; delete S.results.humanize; refreshSlot("cover"); }),
};

// ================= Interview prep =================
view("interview", "Interview Prep", (main) => {
  main.innerHTML = `${pageHead("Interview prep", "Likely questions with answer outlines from your real experience, a portfolio walkthrough, practical-test tips, questions to ask, and pay guidance.")}
  <div class="split"><div class="card"><h2>Which job?</h2>${jobPickerHTML("iv", { compact: true })}${resumePickerHTML()}
    <button class="btn primary" id="ivRun"><span class="ai-dot"></span>Prepare me</button></div>
  <div>${slotHTML("interview")}</div></div>`;
  bindJobPicker(main);
  bindResumePicker(main);
  $("#ivRun").addEventListener("click", () => {
    if (!hasJob()) return toast("Paste the job description first.", "bad");
    runAI("interview", "interviewPrep", { resume: resumeForAI(pickedResume()), job: jobForAI() }, { label: "Preparing questions and answers from your experience…", expect: 70 });
  });
});
slots.interview = {
  empty: () => `<div class="card empty">Your prep sheet will appear here. Everything is editable.</div>`,
  render: (r) => {
    const d = r.data;
    return `<div class="card" id="ivSheet">
      <h2>Likely questions</h2><ul class="list">${d.likelyQuestions.map((q) => `<li><b contenteditable="true">${esc(q.question)}</b><div class="small muted" contenteditable="true">Why they ask: ${esc(q.whyTheyAsk)}</div><div class="out-block small" style="margin-top:6px" contenteditable="true">${esc(q.answerOutline)}</div></li>`).join("")}</ul>
      <h2 style="margin-top:16px">Portfolio walkthrough</h2>${editableList(d.portfolioWalkthrough)}
      <div class="grid cols-2" style="margin-top:16px"><div><h3>Practical / design test</h3>${editableList(d.practicalTestTips)}</div><div><h3>Questions to ask them</h3>${editableList(d.questionsToAsk)}</div></div>
      <h3 style="margin-top:16px">Things to probe</h3>${editableList(d.thingsToProbe)}
      <h3 style="margin-top:16px">Rate / salary</h3><p contenteditable="true">${esc(d.rateOrSalaryGuidance)}</p>
      <div class="field"><label>My notes</label><textarea id="ivNotes">${esc(d.myNotes || "")}</textarea></div>
      <div class="row end"><button class="btn small" id="ivCopy">Copy all</button><button class="btn small" id="ivPrint">Print</button><button class="btn small primary" id="ivSave">Save</button></div></div>`;
  },
  bind: (el, r) => {
    $("#ivNotes", el).addEventListener("input", (e) => (r.data.myNotes = e.target.value));
    $("#ivCopy", el).addEventListener("click", () => copyText($("#ivSheet", el).innerText));
    $("#ivPrint", el).addEventListener("click", () => printHTML(`<div class="letter">${esc($("#ivSheet", el).innerText)}</div>`));
    $("#ivSave", el).addEventListener("click", () => saveDocument("interview", `Interview prep: ${S.ui.job.title} @ ${S.ui.job.company}`, { ...r.data, editedText: $("#ivSheet", el).innerText }));
  },
};

// ================= Tracker =================
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function editApplication(t = null) {
  const isNew = !t;
  t = t ? clone(t) : { id: uid(), company: "", role: "", url: "", location: "", type: "", salary: "", status: "saved", savedAt: today(), appliedAt: "", followUpAt: "", contacts: "", notes: "", resumeId: "", coverId: "", description: "", history: [] };
  const covers = S.documents.items.filter((d) => d.type === "cover");
  const d = dialog(`<form method="dialog"><div class="dlg-body"><h2>${isNew ? "Add application" : esc(`${t.role} · ${t.company}`)}</h2>
    <div class="grid cols-2">
      <div class="field"><label>Company</label><input type="text" name="company" value="${esc(t.company)}" required></div>
      <div class="field"><label>Role</label><input type="text" name="role" value="${esc(t.role)}" required></div>
      <div class="field"><label>Status</label><select name="status">${STATUSES.map((s) => `<option value="${s}" ${t.status === s ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("")}</select></div>
      <div class="field"><label>Type</label><select name="type"><option value="">—</option>${JOB_TYPES.map((x) => `<option ${t.type === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="field"><label>Applied on</label><input type="date" name="appliedAt" value="${esc(t.appliedAt)}"></div>
      <div class="field"><label>Follow up on</label><div class="row" style="flex-wrap:nowrap"><input type="date" name="followUpAt" value="${esc(t.followUpAt)}"><button type="button" class="btn small" data-plus="7">+7d</button></div></div>
      <div class="field"><label>Posting URL</label><input type="url" name="url" value="${esc(t.url)}"></div>
      <div class="field"><label>Salary / rate</label><input type="text" name="salary" value="${esc(t.salary)}"></div>
      <div class="field"><label>Resume used</label><select name="resumeId"><option value="">—</option>${S.resumes.items.map((r) => `<option value="${esc(r.id)}" ${t.resumeId === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Cover letter used</label><select name="coverId"><option value="">—</option>${covers.map((c) => `<option value="${esc(c.id)}" ${t.coverId === c.id ? "selected" : ""}>${esc(c.title)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Contacts <span class="hint">recruiter, referrer, hiring manager</span></label><textarea name="contacts" style="min-height:60px">${esc(t.contacts)}</textarea></div>
    <div class="field"><label>Notes</label><textarea name="notes">${esc(t.notes)}</textarea></div>
    <details><summary class="small" style="cursor:pointer">Job description</summary><textarea name="description" class="tall" style="margin-top:6px">${esc(t.description)}</textarea></details>
    ${t.history?.length ? `<p class="small muted" style="margin-top:10px">History: ${t.history.map((h) => `${STATUS_LABEL[h.status]} ${fmtDate(h.at)}`).join(" → ")}</p>` : ""}
  </div><div class="dlg-foot">${isNew ? "" : `<button type="button" class="btn ghost danger" data-delete>Delete</button><button type="button" class="btn ghost" data-use>Use this job in tools</button>`}<span class="grow"></span><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" value="save">Save</button></div></form>`, {
    onOpen: (dlg) => {
      const f = $("form", dlg);
      $("[data-plus]", dlg).addEventListener("click", () => (f.followUpAt.value = addDays(7)));
      f.status.addEventListener("change", () => {
        if (f.status.value === "applied" && !f.appliedAt.value) f.appliedAt.value = today();
        if (["applied", "interviewing"].includes(f.status.value) && !f.followUpAt.value) f.followUpAt.value = addDays(7);
      });
      $("[data-delete]", dlg)?.addEventListener("click", () => {
        if (!confirm("Delete this application?")) return;
        S.tracker.items = S.tracker.items.filter((x) => x.id !== t.id);
        save("tracker");
        dlg.close();
        rerender();
      });
      $("[data-use]", dlg)?.addEventListener("click", () => { setWorkingJob({ title: f.role.value, company: f.company.value, url: f.url.value, description: f.description.value, type: f.type.value, salary: f.salary.value }); dlg.close(); toast("Loaded into Evaluate, Cover Letters, Networking and Interview Prep"); });
      f.addEventListener("submit", () => {
        const fd = Object.fromEntries(new FormData(f));
        if (fd.status !== t.status || isNew) (t.history ||= []).push({ status: fd.status, at: new Date().toISOString() });
        Object.assign(t, fd);
        const i = S.tracker.items.findIndex((x) => x.id === t.id);
        if (i >= 0) S.tracker.items[i] = t;
        else S.tracker.items.unshift(t);
        save("tracker");
        rerender();
      });
    },
  });
  return d;
}

view("tracker", "Tracker", (main) => {
  const items = S.tracker.items;
  const due = items.filter(isFollowUpDue);
  const mode = S.ui.trackerMode || "board";
  main.innerHTML = `${pageHead("Applications", "Saved → applied → interviewing → offer. Keep dates, contacts, and which resume and letter you used.", `<button class="btn" id="csvBtn">Export CSV</button><button class="btn primary" id="addApp">+ Add</button>`)}
  ${due.length ? `<div class="notice warn" style="margin-bottom:14px"><div class="grow"><b>${due.length} follow-up${due.length > 1 ? "s" : ""} due:</b> ${due.map((t) => esc(`${t.role} @ ${t.company}`)).join(", ")}. A short, friendly check-in is normal about a week after applying.</div></div>` : ""}
  <div class="tabs" role="tablist"><button role="tab" aria-selected="${mode === "board"}" data-tm="board">Board</button><button role="tab" aria-selected="${mode === "table"}" data-tm="table">Table</button></div>
  ${!items.length ? `<div class="card empty">No applications yet. Add one, or press “Track” on any job.</div>` : mode === "board" ? `<div class="kanban">${STATUSES.map((s) => {
    const its = items.filter((t) => t.status === s);
    return `<div class="lane"><h4><span>${STATUS_LABEL[s]}</span><span>${its.length}</span></h4>${its.map((t) => `<div class="app-card" data-app="${esc(t.id)}" tabindex="0" role="button"><b>${esc(t.role)}</b><div class="muted">${esc(t.company)}</div>
      ${t.appliedAt ? `<div class="small faint">Applied ${fmtDate(t.appliedAt)}</div>` : ""}${isFollowUpDue(t) ? `<div class="due">Follow up due</div>` : t.followUpAt && ["applied", "interviewing", "saved"].includes(t.status) ? `<div class="small faint">Follow up ${fmtDate(t.followUpAt)}</div>` : ""}</div>`).join("")}</div>`;
  }).join("")}</div>` : `<div class="card table-wrap"><table><thead><tr><th>Role</th><th>Company</th><th>Status</th><th>Applied</th><th>Follow up</th><th>Type</th><th>Resume</th></tr></thead><tbody>
    ${items.map((t) => `<tr data-app="${esc(t.id)}" style="cursor:pointer"><td><b>${esc(t.role)}</b></td><td>${esc(t.company)}</td><td>${STATUS_LABEL[t.status]}</td><td>${fmtDate(t.appliedAt)}</td><td ${isFollowUpDue(t) ? 'style="color:var(--bad);font-weight:600"' : ""}>${fmtDate(t.followUpAt)}</td><td>${esc(t.type)}</td><td class="small">${esc(resumeById(t.resumeId)?.name || "")}</td></tr>`).join("")}</tbody></table></div>`}`;
  $("#addApp").addEventListener("click", () => editApplication());
  $$("[data-tm]", main).forEach((b) => b.addEventListener("click", () => { S.ui.trackerMode = b.dataset.tm; rerender(); }));
  main.addEventListener("click", (e) => { const a = e.target.closest("[data-app]"); if (a) editApplication(S.tracker.items.find((x) => x.id === a.dataset.app)); });
  main.addEventListener("keydown", (e) => { const a = e.target.closest("[data-app]"); if (a && e.key === "Enter") editApplication(S.tracker.items.find((x) => x.id === a.dataset.app)); });
  $("#csvBtn").addEventListener("click", () => {
    const cols = ["company", "role", "status", "type", "salary", "appliedAt", "followUpAt", "url", "contacts", "notes"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    download(`applications-${today()}.csv`, [cols.join(","), ...items.map((t) => cols.map((c) => q(t[c])).join(","))].join("\n"), "text/csv");
  });
});

// ================= Settings =================
view("settings", "Settings", async (main) => {
  main.innerHTML = `${pageHead("Settings", "Keys are stored only in data/settings.json on this computer and never shown back in full.")}<div class="loading"><div class="spinner"></div>Loading…</div>`;
  let s;
  try { s = await api("GET", "/api/state/settings"); } catch (e) { main.innerHTML = errorHTML(e); return; }
  const keyField = (k, label, hint, href) => `<div class="field"><label>${label} ${href ? `<a class="hint" href="${href}" target="_blank" rel="noopener">get one ↗</a>` : ""}</label>
    <div class="row" style="flex-wrap:nowrap"><input type="password" name="${k}" autocomplete="off" placeholder="${s[`${k}Set`] ? `Saved: ${esc(s[k])}${s[`${k}FromEnv`] ? " (from .env)" : ""}` : "Not set"}">${s[`${k}Set`] && !s[`${k}FromEnv`] ? `<button type="button" class="btn small ghost danger" data-clear="${k}">Remove</button>` : ""}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  const theme = ls.get("theme", "system");
  main.innerHTML = `${pageHead("Settings", "Keys are stored only in data/settings.json on this computer and never shown back in full.")}
  <form id="setForm" class="stack" autocomplete="off">
    <div class="card"><h2>Claude (AI features)</h2>
      ${keyField("anthropicApiKey", "Anthropic API key", "Used for evaluation, tailoring, writing, company research and AI web search. Billed to your Anthropic account.", "https://console.anthropic.com/settings/keys")}
      <div class="field"><label>Model</label><input type="text" name="model" value="${esc(s.model)}" list="models" style="max-width:320px"><datalist id="models"><option value="claude-opus-5-5"><option value="claude-sonnet-5-5"><option value="claude-haiku-5-5"></datalist><div class="hint">Default claude-opus-5-5 (best writing and judgment). Sonnet is cheaper and faster.</div></div>
      <label class="check"><input type="checkbox" name="useFallbacks" ${s.useFallbacks ? "checked" : ""}>Server-side fallbacks</label>
      <div class="hint">On by default. If the model declines a request, Anthropic retries it on a fallback model so you still get an answer. Turn off to only ever use the model above.</div>
    </div>
    <div class="card"><h2>Job search keys <span class="hint">all optional, all free tiers</span></h2>
      <div class="grid cols-2">
        <div class="field"><label>Adzuna app ID <a class="hint" href="https://developer.adzuna.com/" target="_blank" rel="noopener">get one ↗</a></label><input type="text" name="adzunaAppId" value="${esc(s.adzunaAppId)}"></div>
        ${keyField("adzunaAppKey", "Adzuna app key", "")}
        <div class="field"><label>Adzuna country</label><select name="adzunaCountry">${["us", "gb", "ca", "au", "de", "fr", "nl", "in", "nz", "sg", "za", "at", "be", "br", "ch", "es", "it", "mx", "pl"].map((c) => `<option ${s.adzunaCountry === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        ${keyField("rapidApiKey", "RapidAPI key (JSearch)", "Subscribe to JSearch's free plan on RapidAPI. Covers LinkedIn, Indeed, Glassdoor, ZipRecruiter via Google for Jobs.", "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch")}
        ${keyField("usajobsKey", "USAJOBS key", "", "https://developer.usajobs.gov/apirequest/")}
        <div class="field"><label>USAJOBS email <span class="hint">the one you registered with</span></label><input type="email" name="usajobsEmail" value="${esc(s.usajobsEmail)}"></div>
      </div></div>
    <div class="card"><h2>Company career boards</h2><p class="small muted">Board names from the company's careers URL, e.g. boards.greenhouse.io/<b>figma</b>, jobs.lever.co/<b>name</b>, jobs.ashbyhq.com/<b>name</b>. Add studios you'd love to work at.</p>
      <div class="grid cols-3">${[["greenhouseBoards", "Greenhouse"], ["leverBoards", "Lever"], ["ashbyBoards", "Ashby"]].map(([k, l]) => `<div class="field"><label>${l}</label><textarea name="${k}" style="min-height:140px">${esc((s[k] || []).join("\n"))}</textarea></div>`).join("")}</div>
      <button type="button" class="btn small ghost" id="resetBoards">Reset to defaults</button></div>
    <div class="row"><button class="btn primary" type="submit">Save settings</button></div>
  </form>
  <div class="card" style="margin-top:14px"><h2>Job sources</h2><ul class="list">${(S.status.sources || []).map((x) => `<li class="row"><span class="badge ${x.active ? "good" : ""}">${x.active ? "active" : "off"}</span><b>${esc(x.name)}</b><span class="small muted grow">${esc(x.note)}</span></li>`).join("")}</ul></div>
  <div class="card" style="margin-top:14px"><h2>Appearance</h2><div class="seg" role="radiogroup">${["system", "light", "dark"].map((t) => `<label><input type="radio" name="theme" value="${t}" ${theme === t ? "checked" : ""}>${t[0].toUpperCase() + t.slice(1)}</label>`).join("")}</div></div>
  <div class="card" style="margin-top:14px"><h2>Privacy</h2><p class="small">Your profile, resumes, letters, tracker and keys are saved as JSON files in the <code class="mono">data/</code> folder of this app, which git ignores. The server only listens on this computer. Text is sent to Anthropic only when you press an AI button, and job searches call the job boards directly.</p></div>`;
  const form = $("#setForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = { model: fd.get("model"), useFallbacks: !!fd.get("useFallbacks"), adzunaAppId: fd.get("adzunaAppId"), adzunaCountry: fd.get("adzunaCountry"), usajobsEmail: fd.get("usajobsEmail"), greenhouseBoards: fd.get("greenhouseBoards"), leverBoards: fd.get("leverBoards"), ashbyBoards: fd.get("ashbyBoards") };
    for (const k of ["anthropicApiKey", "adzunaAppKey", "rapidApiKey", "usajobsKey"]) if (fd.get(k)) body[k] = fd.get(k);
    try {
      await api("PUT", "/api/state/settings", body);
      await refreshStatus();
      S.ui.searchForm = null;
      toast("Settings saved");
      rerender();
    } catch (err) { toast(err.message, "bad"); }
  });
  main.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-clear]");
    if (c && confirm("Remove this key?")) { await api("PUT", "/api/state/settings", { [c.dataset.clear]: "" }); await refreshStatus(); rerender(); }
    if (e.target.id === "resetBoards") { for (const k of ["greenhouse", "lever", "ashby"]) form[`${k}Boards`].value = (s.defaultBoards[k] || []).join("\n"); toast("Defaults filled in. Save to apply."); }
  });
  main.addEventListener("change", (e) => { if (e.target.name === "theme") { ls.set("theme", e.target.value); applyTheme(); } });
});

// ================= Boot =================
function applyTheme() {
  const t = ls.get("theme", "system");
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = t;
}
const isDark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

async function boot() {
  applyTheme();
  $("#themeBtn").addEventListener("click", () => { ls.set("theme", isDark() ? "light" : "dark"); applyTheme(); });
  $("#menuBtn").addEventListener("click", () => {
    const open = !$("#sidebar").classList.contains("open");
    $("#sidebar").classList.toggle("open", open);
    $("#scrim").hidden = !open;
    $("#menuBtn").setAttribute("aria-expanded", String(open));
  });
  $("#scrim").addEventListener("click", closeMenu);
  $("#focusPill").addEventListener("change", (e) => {
    S.profile.activeFocusId = e.target.value;
    save("profile");
    S.ui.searchForm = null;
    toast(`Focus: ${activeFocus().label}`);
    rerender();
  });
  try {
    await loadAll();
  } catch (e) {
    $("#main").innerHTML = errorHTML(e);
    return;
  }
  window.addEventListener("hashchange", () => { render(); $("#main").focus({ preventScroll: true }); window.scrollTo(0, 0); });
  render();
}
boot();
