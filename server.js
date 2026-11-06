// Career Copilot local server: static UI + JSON API. No framework, binds to localhost only.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadDotEnv, read, write, isAllowedKey, settings, DEFAULT_BOARDS } from "./lib/store.js";
import { analyze } from "./lib/ats.js";
import { findAiTells, findSkills, norm, AI_TELLS } from "./lib/text.js";
import { searchJobs, verifyPosting, SOURCE_INFO, classifyType, flagsFor } from "./lib/jobs.js";
import { parseUpload, resumeToDocx, coverLetterToDocx, resumeToText } from "./lib/files.js";
import { tasks, aiStatus, requireAi } from "./lib/ai.js";

loadDotEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT) || 5317;
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY = 25 * 1024 * 1024;
const COMPANY_TTL = 14 * 86400000;
const SECRET_KEYS = ["anthropicApiKey", "deepseekApiKey", "adzunaAppKey", "rapidApiKey", "usajobsKey"];

// ---------- Seed data ----------

export const DEFAULT_FOCUS = {
  id: "motion",
  label: "Motion graphics",
  roles: ["Motion Designer", "Motion Graphics Designer", "Animator", "2D/3D Motion Designer", "Video Editor"],
  keywords: ["After Effects", "Cinema 4D", "Rive", "Lottie", "Illustrator", "Photoshop", "Premiere Pro"],
  avoidKeywords: [],
  industries: [],
  seniority: "",
};

function seed() {
  if (!read("profile")) {
    write("profile", {
      name: "", headline: "", location: "", links: [],
      whoIAm: "", whatIDo: "", proudestWork: "", values: "", workStyle: "", story: "", goals: "", dealBreakers: "",
      preferences: { workplace: ["Remote", "Hybrid"], types: ["Full-time", "Contract", "Freelance"], minPay: "", locations: "" },
      voiceSamples: "",
      focuses: [DEFAULT_FOCUS],
      activeFocusId: DEFAULT_FOCUS.id,
    });
  }
  for (const [k, v] of [["resumes", { activeId: null, items: [] }], ["tracker", { items: [] }], ["saved-jobs", { items: [] }], ["documents", { items: [] }], ["companies", {}]]) {
    if (!read(k)) write(k, v);
  }
}

// ---------- Helpers ----------

function mask(v) {
  if (!v) return "";
  const s = String(v);
  return s.length <= 8 ? "••••" : `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

function publicSettings() {
  const s = settings();
  const saved = read("settings", {}) || {};
  const out = { ...s };
  for (const k of SECRET_KEYS) {
    out[k] = mask(s[k]);
    out[`${k}Set`] = !!s[k];
    out[`${k}FromEnv`] = !!s[k] && !saved[k];
  }
  out.defaultBoards = DEFAULT_BOARDS;
  return out;
}

function saveSettings(incoming = {}) {
  const saved = read("settings", {}) || {};
  const next = { ...saved };
  const allowed = ["aiProvider", "anthropicApiKey", "deepseekApiKey", "deepseekModel", "model", "adzunaAppId", "adzunaAppKey", "adzunaCountry", "rapidApiKey", "usajobsKey", "usajobsEmail", "greenhouseBoards", "leverBoards", "ashbyBoards", "useFallbacks"];
  for (const k of allowed) {
    if (!(k in incoming)) continue;
    let v = incoming[k];
    // A masked value coming back from the UI means "unchanged".
    if (SECRET_KEYS.includes(k) && typeof v === "string" && v.includes("••")) continue;
    if (k.endsWith("Boards")) v = (Array.isArray(v) ? v : String(v || "").split(/[\s,]+/)).map((x) => x.trim()).filter(Boolean);
    if (k === "useFallbacks") v = !!v;
    if (typeof v === "string") v = v.trim();
    if (v === "" || v == null) delete next[k];
    else next[k] = v;
  }
  write("settings", next);
  return publicSettings();
}

function activeFocus(profile) {
  const p = profile || {};
  return (p.focuses || []).find((f) => f.id === p.activeFocusId) || (p.focuses || [])[0] || DEFAULT_FOCUS;
}

function activeResume() {
  const r = read("resumes", { items: [] }) || { items: [] };
  return (r.items || []).find((x) => x.id === r.activeId) || (r.items || [])[0] || null;
}

function sourcesStatus() {
  const s = settings();
  const active = {
    adzuna: !!(s.adzunaAppId && s.adzunaAppKey),
    jsearch: !!s.rapidApiKey,
    usajobs: !!(s.usajobsKey && s.usajobsEmail),
    web: aiStatus(s).ready && aiStatus(s).webSearch,
    greenhouse: (s.greenhouseBoards || []).length > 0,
    lever: (s.leverBoards || []).length > 0,
    ashby: (s.ashbyBoards || []).length > 0,
  };
  return SOURCE_INFO.map((x) => ({ ...x, active: active[x.id] ?? !x.keyed }));
}

function send(res, status, body, headers = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(data);
}

function fail(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw fail(413, "Request too large (25 MB max).");
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw fail(400, "Body must be JSON.");
  }
}

// Turn SDK/API errors into messages a person can act on.
function friendly(e) {
  const status = e.status || 500;
  const name = e.constructor?.name || "";
  if (e.expose || e.code === "NO_API_KEY") return { status: status >= 400 && status < 600 ? status : 500, error: e.message, code: e.code };
  if (name === "AuthenticationError" || status === 401) return { status: 401, error: "Anthropic rejected the API key. Check it in Settings (console.anthropic.com → API keys).", code: "BAD_API_KEY" };
  if (name === "PermissionDeniedError" || status === 403) return { status: 403, error: `Your API key isn't allowed to do this: ${e.message}`, code: "FORBIDDEN" };
  if (name === "NotFoundError" && /model/i.test(e.message)) return { status: 400, error: `Model not available to your key: ${e.message}. Pick another model in Settings.`, code: "BAD_MODEL" };
  if (name === "RateLimitError" || status === 429) return { status: 429, error: "Rate limited by Anthropic. Wait a minute and try again.", code: "RATE_LIMIT" };
  if (status === 529 || /overloaded/i.test(e.message)) return { status: 503, error: "Claude is overloaded right now. Try again in a minute.", code: "OVERLOADED" };
  if (/credit balance|billing/i.test(e.message)) return { status: 402, error: "Your Anthropic account is out of credit. Add credit at console.anthropic.com → Billing.", code: "NO_CREDIT" };
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") return { status: 504, error: "Couldn't reach Anthropic. Check your internet connection.", code: "NETWORK" };
  if (/Failed to parse structured output/.test(e.message)) return { status: 502, error: "Claude's answer didn't match the expected format. Try again.", code: "BAD_OUTPUT" };
  return { status: status >= 400 && status < 600 ? status : 500, error: e.message || String(e), code: e.code };
}

// ---------- Format lock for tailoring ----------

const key = (s) => norm(s || "");

/**
 * Keep the original resume's structure: section order and headings, every
 * item's title/organization/location/dates, contact details and format.
 * Returns the locked resume and a report of what had to be restored.
 */
export function enforceFormat(original, tailored) {
  const report = { restored: [], warnings: [] };
  if (!original?.sections || !tailored?.sections) {
    report.warnings.push("Original resume isn't structured, so the format lock couldn't be applied.");
    return { resume: tailored, report };
  }
  const out = { ...tailored, contact: { ...tailored.contact }, format: { ...original.format } };

  for (const f of ["name", "email", "phone", "location"]) {
    if ((original.contact?.[f] || "") !== (tailored.contact?.[f] || "")) {
      if (tailored.contact?.[f]) report.restored.push(`Contact ${f} changed from "${original.contact?.[f] || ""}" to "${tailored.contact[f]}"; kept the original.`);
      out.contact[f] = original.contact?.[f] || "";
    }
  }
  const tLinks = tailored.contact?.links || [];
  const oLinks = original.contact?.links || [];
  if (JSON.stringify(tLinks) !== JSON.stringify(oLinks)) {
    report.restored.push("Contact links changed; kept the original links.");
    out.contact.links = oLinks;
  }
  if (tailored.contact?.headline !== original.contact?.headline) report.warnings.push(`Headline changed: "${original.contact?.headline || ""}" → "${tailored.contact?.headline || ""}". Review it.`);

  const pool = [...tailored.sections];
  const take = (pred) => {
    const i = pool.findIndex(pred);
    return i === -1 ? null : pool.splice(i, 1)[0];
  };
  out.sections = original.sections.map((os, idx) => {
    let ts = take((s) => key(s.heading) === key(os.heading)) || take((s) => s.kind === os.kind && tailored.sections.indexOf(s) === idx) || take((s) => s.kind === os.kind && os.kind !== "other");
    if (!ts) {
      report.warnings.push(`Section "${os.heading}" was missing from the tailored version; restored the original.`);
      return structuredClone(os);
    }
    const s = { ...ts, heading: os.heading, kind: os.kind };
    if (ts.heading !== os.heading) report.restored.push(`Heading "${ts.heading}" renamed back to "${os.heading}".`);
    const oi = os.items || [], ti = ts.items || [];
    if (oi.length === ti.length) {
      s.items = ti.map((it, i) => {
        const o = oi[i];
        const fixed = { ...it };
        for (const f of ["title", "organization", "location", "dates"]) {
          if ((it[f] || "") !== (o[f] || "")) {
            report.restored.push(`${os.heading} #${i + 1}: ${f} "${it[f] || ""}" → "${o[f] || ""}" (original kept).`);
            fixed[f] = o[f] || "";
          }
        }
        return fixed;
      });
    } else {
      report.warnings.push(`"${os.heading}" has ${ti.length} items instead of ${oi.length}. Titles/dates were matched by organization where possible; review this section.`);
      s.items = ti.map((it) => {
        const o = oi.find((x) => key(x.organization) && key(x.organization) === key(it.organization) && key(x.title) === key(it.title)) || oi.find((x) => key(x.organization) && key(x.organization) === key(it.organization));
        if (!o) {
          report.warnings.push(`"${it.title}${it.organization ? ` at ${it.organization}` : ""}" isn't in your original resume. Remove it unless it's real.`);
          return it;
        }
        return { ...it, title: o.title, organization: o.organization, location: o.location, dates: o.dates };
      });
    }
    for (let i = 0; i < Math.min(oi.length, s.items.length); i++) {
      const d = (s.items[i].bullets || []).length - (oi[i].bullets || []).length;
      if (Math.abs(d) > 1) report.warnings.push(`${os.heading} #${i + 1} went from ${(oi[i].bullets || []).length} to ${(s.items[i].bullets || []).length} bullets.`);
    }
    return s;
  });
  for (const extra of pool) report.warnings.push(`The AI added a new section "${extra.heading}". It was left out to keep your format; add it by hand if you want it.`);
  return { resume: out, report };
}

// ---------- Job search profile ----------

function searchProfile() {
  const profile = read("profile", {}) || {};
  const focus = activeFocus(profile);
  const resume = activeResume();
  const text = resume ? resume.text || (resume.structured ? resumeToText(resume.structured) : "") : "";
  const skills = [...new Set([...findSkills(text), ...findSkills((focus.keywords || []).join(", "))])];
  return { targetRoles: focus.roles || [], keywords: focus.keywords || [], avoidKeywords: focus.avoidKeywords || [], skills };
}

// ---------- Routes ----------

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, pattern, fn });

route("GET", /^\/api\/status$/, () => {
  const s = settings();
  const r = read("resumes", { items: [] }) || { items: [] };
  return {
    ok: true,
    hasAnthropicKey: !!s.anthropicApiKey,
    ai: aiStatus(s),
    aiReady: aiStatus(s).ready,
    model: s.model,
    useFallbacks: s.useFallbacks,
    resumes: (r.items || []).length,
    activeResumeId: r.activeId,
    sources: sourcesStatus(),
    aiTells: AI_TELLS,
    version: "1.0.0",
  };
});

route("GET", /^\/api\/sources$/, () => ({ sources: sourcesStatus() }));

route("GET", /^\/api\/state\/([\w-]+)$/, (req, m) => {
  const k = m[1];
  if (!isAllowedKey(k)) throw fail(404, `Unknown state key "${k}".`);
  if (k === "settings") return publicSettings();
  return read(k, null);
});

route("PUT", /^\/api\/state\/([\w-]+)$/, (req, m, body) => {
  const k = m[1];
  if (!isAllowedKey(k)) throw fail(404, `Unknown state key "${k}".`);
  if (k === "settings") return saveSettings(body);
  if (body == null || typeof body !== "object") throw fail(400, "State must be a JSON object or array.");
  write(k, body);
  return { ok: true };
});

route("POST", /^\/api\/parse$/, async (req, m, body) => {
  if (!body.data) throw fail(400, "Send {name, mime, data} with the file as base64.");
  return parseUpload(body);
});

route("POST", /^\/api\/ats$/, (req, m, body) => {
  let resumeText = body.resumeText;
  if (!resumeText && body.resume) resumeText = typeof body.resume === "string" ? body.resume : resumeToText(body.resume);
  if (!resumeText) throw fail(400, "Send resumeText (or a structured resume).");
  const report = analyze({ resumeText, jobText: body.jobText || "", jobTitle: body.jobTitle || "", fileMeta: body.fileMeta || {}, extraKeywords: body.extraKeywords || [] });
  report.aiTells = findAiTells(resumeText);
  if (report.aiTells.length) {
    report.issues.push({ severity: "low", area: "Tone", message: `Phrases that read as generic or AI-written: ${report.aiTells.slice(0, 8).join(", ")}.`, fix: "Replace them with specifics: what you made, for whom, and what happened." });
  }
  return report;
});

route("POST", /^\/api\/ai\/(\w+)$/, async (req, m, body) => {
  const name = m[1];
  const fn = tasks[name];
  if (!fn) throw fail(404, `Unknown AI task "${name}".`);
  requireAi();
  const input = { ...body };
  if (!input.profile) input.profile = read("profile", {});
  if (["evaluate", "tailor", "coverLetter", "interviewPrep"].includes(name) && !input.resume) {
    const r = activeResume();
    if (!r) throw fail(400, "Add a resume first (Resumes tab).", "NO_RESUME");
    input.resume = r;
  }
  if (["evaluate", "tailor", "coverLetter", "interviewPrep", "referralPlan"].includes(name) && !input.job) throw fail(400, "Paste or pick a job first.", "NO_JOB");

  if (name === "companyResearch") {
    if (!input.company) throw fail(400, "Which company?");
    const cache = read("companies", {}) || {};
    const ck = key(input.company);
    const hit = cache[ck];
    if (hit && !input.refresh && Date.now() - new Date(hit.fetchedAt).getTime() < COMPANY_TTL) return { ...hit, cached: true };
    const r = await fn(input);
    const entry = { data: r.data, sources: r.sources, fetchedAt: new Date().toISOString(), model: r.model };
    write("companies", { ...(read("companies", {}) || {}), [ck]: entry });
    return { ...entry, cached: false, usage: r.usage };
  }
  if (name === "webJobSearch") {
    const focus = activeFocus(input.profile);
    input.queries = input.queries?.length ? input.queries : focus.roles?.slice(0, 3) || ["motion designer"];
  }

  const result = await fn(input);
  if (name === "tailor") {
    const original = input.resume?.structured;
    const { resume, report } = enforceFormat(original, result.data.resume);
    result.data.resume = resume;
    result.formatReport = report;
    // Re-run the deterministic ATS check on before/after so the UI can show the change.
    const jobText = typeof input.job === "string" ? input.job : `${input.job.title || ""}\n${input.job.description || input.job.text || ""}`;
    const jobTitle = typeof input.job === "string" ? "" : input.job.title || "";
    const beforeText = original ? resumeToText(original) : input.resume.text || "";
    result.ats = {
      before: analyze({ resumeText: beforeText, jobText, jobTitle }).overall,
      after: analyze({ resumeText: resumeToText(resume), jobText, jobTitle }).overall,
    };
  }
  if (name === "coverLetter" || name === "humanize") {
    const text = name === "coverLetter" ? result.data.body : result.data.text;
    result.aiTells = findAiTells(text || "");
  }
  return result;
});

route("POST", /^\/api\/jobs\/search$/, async (req, m, body) => {
  const s = settings();
  const profile = searchProfile();
  const q = { ...body };
  if (!q.queries?.length) q.queries = (profile.targetRoles || []).slice(0, 3);
  const wantWeb = (q.sources || []).includes("web");
  const listSources = (q.sources || []).filter((x) => x !== "web");
  const [main, web] = await Promise.all([
    listSources.length || !q.sources?.length ? searchJobs({ ...q, sources: listSources }, s, profile) : Promise.resolve({ jobs: [], status: {}, dropped: {}, total: 0 }),
    wantWeb ? tasks.webJobSearch({ profile: read("profile", {}), queries: q.queries, location: q.location, maxAgeDays: q.maxAgeDays || 30, remoteOnly: q.remoteOnly }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e })) : null,
  ]);
  if (web) {
    if (web.ok) {
      const list = Array.isArray(web.r.data?.jobs) ? web.r.data.jobs : [];
      const seen = new Set(main.jobs.map((j) => `${key(j.title)}|${key(j.company)}`));
      let added = 0;
      for (const w of list) {
        if (!w.url || !w.title) continue;
        const k = `${key(w.title)}|${key(w.company)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const j = { id: `Web:${w.url}`, source: "AI web search", via: w.source || "", title: w.title, company: w.company || "", location: w.location || "", remote: /remote/i.test(w.location || ""), rawType: w.employmentType || "", salary: w.salary || "", postedAt: Date.parse(w.posted) ? new Date(w.posted).toISOString() : null, postedText: w.posted || "", expiresAt: null, url: w.url, applyUrl: w.url, description: w.whyRelevant || "", tags: [] };
        j.type = classifyType(j);
        if (q.types?.length && !q.types.includes(j.type)) continue;
        j.flags = flagsFor(j);
        j.fit = { score: 50, why: [w.whyRelevant || "found by web search"].filter(Boolean), jobSkills: [], missingSkills: [] };
        main.jobs.push(j);
        added++;
      }
      main.status.web = { ok: true, count: added };
    } else {
      main.status.web = { ok: false, error: friendly(web.e).error };
    }
  }
  return main;
});

route("POST", /^\/api\/jobs\/verify$/, async (req, m, body) => {
  if (Array.isArray(body.urls)) {
    const urls = body.urls.slice(0, 60);
    const out = {};
    // Small batches so we don't hammer any one site.
    for (let i = 0; i < urls.length; i += 6) {
      const part = await Promise.all(urls.slice(i, i + 6).map((u) => verifyPosting(u)));
      urls.slice(i, i + 6).forEach((u, k) => (out[u] = part[k]));
    }
    return { results: out };
  }
  if (!body.url) throw fail(400, "Send {url} or {urls: []}.");
  return verifyPosting(body.url);
});

route("POST", /^\/api\/export\/docx$/, async (req, m, body) => {
  const safe = (s) => String(s || "").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "document";
  let buf, filename;
  if (body.kind === "cover") {
    if (!body.letter?.body) throw fail(400, "Send {kind:'cover', letter:{body,...}}.");
    buf = await coverLetterToDocx(body.letter);
    filename = `${safe(body.filename || `${body.letter.name || "Cover"}-Cover-Letter`)}.docx`;
  } else {
    if (!body.resume?.sections) throw fail(400, "Send {kind:'resume', resume:{contact, sections, format}, template}.");
    buf = await resumeToDocx(body.resume, body.template);
    filename = `${safe(body.filename || `${body.resume.contact?.name || "Resume"}-Resume`)}.docx`;
  }
  return { __raw: buf, headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${filename}"` } };
});

// ---------- Static files ----------

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json" };

function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, "Forbidden");
  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown non-asset paths fall back to the app shell.
      if (!path.extname(p)) return fs.readFile(path.join(PUBLIC, "index.html"), (e2, html) => (e2 ? send(res, 404, "Not found") : send(res, 200, html, { "Content-Type": MIME[".html"] })));
      return send(res, 404, "Not found");
    }
    send(res, 200, data, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  });
}

// ---------- Server ----------

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    return serveStatic(req, res, url.pathname);
  }
  // Only accept browser calls from our own origin (blocks other sites poking localhost).
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return send(res, 403, { error: "Cross-origin requests are not allowed." });
  const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname));
  if (!r) return send(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
  const started = Date.now();
  try {
    const body = ["POST", "PUT"].includes(req.method) ? await readBody(req) : {};
    const out = await r.fn(req, url.pathname.match(r.pattern), body);
    if (out && out.__raw) return send(res, 200, out.__raw, out.headers);
    send(res, 200, out ?? null);
  } catch (e) {
    const f = friendly(e);
    if (f.status >= 500) console.error(`[${req.method} ${url.pathname}]`, e);
    send(res, f.status, { error: f.error, code: f.code });
  } finally {
    if (process.env.LOG) console.log(`${req.method} ${url.pathname} ${Date.now() - started}ms`);
  }
}

seed();
const server = http.createServer(handle);
// AI calls can run for minutes; don't let Node cut them off.
server.requestTimeout = 15 * 60 * 1000;
server.headersTimeout = 60 * 1000;
// The portable launcher sets OPEN_BROWSER=1 so a double-click opens the app.
function openBrowser(url) {
  if (process.env.OPEN_BROWSER !== "1") return;
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // Opening the browser is a convenience; the URL is printed either way.
  }
}

const url = `http://localhost:${PORT}`;
server.on("error", async (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  // Already running (e.g. double-clicked twice)? Just open it.
  const ours = await fetch(`http://127.0.0.1:${PORT}/api/status`).then((r) => r.ok, () => false);
  if (ours) {
    console.log(`Career Copilot is already running at ${url}. Opening it.`);
    openBrowser(url);
    process.exit(0);
  }
  console.error(`Port ${PORT} is used by another program. Close it, or start with a different PORT (e.g. PORT=5318).`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const s = settings();
  console.log(`Career Copilot running at ${url}`);
  const a = aiStatus(s);
  console.log(a.ready ? `AI: ${a.label}, ${a.model}${a.provider === "claude" && s.useFallbacks ? " (server-side fallbacks on)" : ""}` : `AI: no ${a.label} API key yet. Add one in Settings to turn on AI features.`);
  openBrowser(url);
});
