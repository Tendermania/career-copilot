// Networking logic with no AI in it: LinkedIn connections import, relevance
// ranking, lead quality scoring and the company map. Deterministic, so the same
// data always gives the same answer and it works without an API key.
import { norm, stem, contentTokens } from "./text.js";

const DAY = 86400000;

// ---------- Companies ----------

const COMPANY_SUFFIX = /\b(incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|sa|ag|bv|pty|llp|lp|group|holdings|studios?|agency|the)\b/g;

/** "The Acme Studio, Inc." and "ACME" → "acme". Falls back to the plain name if stripping leaves nothing. */
export function companyKey(name) {
  const n = norm(String(name || "").replace(/&/g, " and ")).replace(/[./+#]/g, " ");
  const stripped = n.replace(COMPANY_SUFFIX, " ").replace(/\s+/g, " ").trim();
  return stripped || n.replace(/\s+/g, " ").trim();
}

// ---------- CSV ----------

/** RFC 4180-style CSV to rows of strings (handles quotes, commas and newlines inside quotes). */
export function parseCsv(text) {
  const s = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim()));
}

function hashId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `c${h.toString(36)}`;
}

function toIsoDate(v) {
  if (!v) return "";
  const t = Date.parse(v);
  return Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
}

const COLS = {
  first: ["first name", "firstname", "given name"],
  last: ["last name", "lastname", "surname", "family name"],
  name: ["name", "full name"],
  url: ["url", "profile url", "linkedin", "linkedin url", "profile"],
  email: ["email address", "email", "e-mail"],
  company: ["company", "organization", "employer", "current company"],
  position: ["position", "title", "job title", "headline", "role"],
  connectedOn: ["connected on", "connected", "date connected"],
};

/**
 * Parse LinkedIn's "Connections.csv" (Settings → Data privacy → Get a copy of your
 * data). The file starts with a few "Notes:" lines before the header row, so the
 * header is found by name. Also accepts any CSV with name/company/title columns.
 */
export function parseConnections(csvText) {
  const rows = parseCsv(csvText);
  const hi = rows.findIndex((r) => {
    const l = r.map((x) => x.toLowerCase());
    return (l.includes("first name") && l.includes("last name")) || ((l.includes("name") || l.includes("full name")) && l.some((x) => COLS.company.includes(x) || COLS.position.includes(x)));
  });
  if (hi === -1) {
    const e = new Error("That doesn't look like a LinkedIn connections file. It needs a header row with First Name, Last Name, Company and Position (LinkedIn's Connections.csv has these).");
    e.status = 400;
    e.expose = true;
    throw e;
  }
  const header = rows[hi].map((x) => x.toLowerCase());
  const col = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  const get = (r, k) => (col[k] >= 0 ? r[col[k]] || "" : "");
  const seen = new Set();
  const items = [];
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    if (!r.some(Boolean)) continue;
    const name = (get(r, "name") || `${get(r, "first")} ${get(r, "last")}`).replace(/\s+/g, " ").trim();
    if (!name) { skipped++; continue; }
    const c = { name, firstName: get(r, "first") || name.split(" ")[0], url: get(r, "url"), email: get(r, "email"), company: get(r, "company"), position: get(r, "position"), connectedOn: toIsoDate(get(r, "connectedOn")) };
    c.id = hashId((c.url || `${c.name}|${c.company}`).toLowerCase());
    if (seen.has(c.id)) { skipped++; continue; }
    seen.add(c.id);
    items.push(c);
  }
  return { items, skipped };
}

// ---------- Reading a job title ----------

const RECRUITER_RE = /\b(recruit\w*|talent|sourcer|sourcing|staffing|people (ops|operations|partner)|human resources|hr (manager|business partner|generalist|director|lead)|headhunter)\b/i;
const LEADER_RE = /\b(director|head of|head|vp|vice president|chief|c[emopt]o|founder|co-?founder|owner|principal|partner|president|lead|manager|supervisor|producer)\b/i;
const EXEC_RE = /\b(chief|c[emopt]o|founder|co-?founder|owner|president)\b/i;
const GENERIC = new Set(["senior", "junior", "lead", "manag", "specialist", "coordinat", "associat", "direct", "head", "assistant", "intern", "freelanc", "contract", "remot", "full", "part", "time"].map(stem));

/** Words that describe the person's field (from focus roles/keywords and resume skills), stemmed. */
export function fieldStems(focus = {}, skills = []) {
  const out = new Set();
  for (const s of [...(focus.roles || []), ...(focus.keywords || []), ...(focus.industries || []), ...skills]) for (const t of contentTokens(s)) if (t.length > 2 && !GENERIC.has(t)) out.add(t);
  return out;
}

/** What kind of contact a job title suggests. */
export function roleType(position, field = new Set()) {
  const p = String(position || "");
  if (!p.trim()) return { type: "other", fieldHits: [] };
  const fieldHits = [...new Set(contentTokens(p).filter((t) => field.has(t)))];
  if (RECRUITER_RE.test(p)) return { type: "recruiter", fieldHits };
  if (LEADER_RE.test(p) && fieldHits.length) return { type: "hiring manager", fieldHits };
  if (fieldHits.length) return { type: "peer in field", fieldHits };
  if (EXEC_RE.test(p)) return { type: "leader", fieldHits };
  return { type: "other", fieldHits };
}

// ---------- Context: everything the user is targeting ----------

const ACTIVE = new Set(["applied", "interviewing", "offer"]);

/**
 * Build the picture of where the person wants in: companies from tracked
 * applications, saved jobs, the job they're working on and their target list.
 */
export function buildContext({ profile = {}, focus = {}, skills = [], tracker = [], savedJobs = [], workingJob = null, targets = [], pastEmployers = [] } = {}) {
  const companies = new Map();
  const touch = (name) => {
    const k = companyKey(name);
    if (!k) return null;
    if (!companies.has(k)) companies.set(k, { key: k, name: String(name).trim(), jobs: [], target: false });
    return companies.get(k);
  };
  for (const t of tracker) {
    const c = touch(t.company);
    if (c) c.jobs.push({ id: t.id, title: t.role || "", status: t.status || "saved", appliedAt: t.appliedAt || "", followUpAt: t.followUpAt || "", source: "tracker" });
  }
  for (const j of savedJobs) {
    const c = touch(j.company);
    if (c && !c.jobs.some((x) => norm(x.title) === norm(j.title))) c.jobs.push({ id: j.id, title: j.title || "", status: "saved", appliedAt: "", source: "saved" });
  }
  if (workingJob?.company) {
    const c = touch(workingJob.company);
    if (c && workingJob.title && !c.jobs.some((x) => norm(x.title) === norm(workingJob.title))) c.jobs.push({ id: workingJob.id || "", title: workingJob.title, status: "considering", appliedAt: "", source: "working" });
  }
  for (const n of targets) {
    const c = touch(n);
    if (c) c.target = true;
  }
  for (const c of companies.values()) {
    c.level = c.jobs.some((j) => ACTIVE.has(j.status)) ? "active" : c.jobs.length ? "saved" : "target";
  }
  return { profile, focus, field: fieldStems(focus, skills), companies, pastEmployers: new Set(pastEmployers.map(companyKey).filter(Boolean)), now: Date.now() };
}

/** Match a contact's company to a targeted one, tolerating "Acme" vs "Acme Studios NYC". */
export function matchCompany(name, ctx) {
  const k = companyKey(name);
  if (!k) return null;
  if (ctx.companies.has(k)) return ctx.companies.get(k);
  for (const c of ctx.companies.values()) {
    const [a, b] = k.length < c.key.length ? [k, c.key] : [c.key, k];
    if (a.length >= 4 && (b.startsWith(`${a} `) || b.endsWith(` ${a}`))) return c;
  }
  return null;
}

const jobLabel = (j) => `${j.title || "a role"}${j.status === "applied" ? " (applied)" : j.status === "interviewing" ? " (interviewing)" : j.status === "offer" ? " (offer)" : j.status === "considering" ? " (looking at)" : " (saved)"}`;

// ---------- Ranking imported connections ----------

/** Score one connection for "could this person help my search?" with the reasons. */
export function scoreConnection(c, ctx) {
  let score = 0;
  const reasons = [];
  const tags = [];
  const co = matchCompany(c.company, ctx);
  const role = roleType(c.position, ctx.field);
  if (co) {
    const pts = co.level === "active" ? 45 : co.level === "saved" ? 38 : 32;
    score += pts;
    tags.push("target company");
    reasons.push(co.jobs.length ? `works at ${co.name}, where you have ${co.jobs.slice(0, 2).map(jobLabel).join(" and ")}` : `works at ${co.name}, on your target list`);
  }
  if (role.type === "hiring manager") { score += 28; tags.push("same field"); reasons.push(`leads work in your field (${c.position})`); }
  else if (role.type === "peer in field") { score += 22; tags.push("same field"); reasons.push(`does similar work (${c.position}), so can vouch or knows who's hiring`); }
  else if (role.type === "recruiter") { score += co ? 20 : 9; tags.push("recruiter"); reasons.push(co ? "recruiter at a company you're targeting" : "recruiter; may know of matching openings"); }
  else if (role.type === "leader") { score += co ? 12 : 5; if (co) reasons.push(`senior person there (${c.position})`); }
  else if (co && c.position) { score += 6; reasons.push(`inside the company (${c.position}); can tell you how hiring works there`); }
  const ck = companyKey(c.company);
  if (ck && ctx.pastEmployers.has(ck) && !co) { score += 15; tags.push("past employer"); reasons.push(`works at ${c.company}, where you used to work`); }
  if (c.connectedOn && ctx.now - Date.parse(c.connectedOn) < 365 * DAY) { score += 4; if (score > 10) reasons.push("connected in the last year"); }
  score = Math.max(0, Math.min(100, score));
  return { score, tier: score >= 60 ? "strong" : score >= 35 ? "good" : score >= 15 ? "maybe" : "weak", reasons, tags, roleType: role.type, companyKey: co?.key || "", jobs: co ? co.jobs.slice(0, 3) : [] };
}

export function rankConnections(connections, ctx, { dismissed = [], leadKeys = new Set(), search = "", limit = 150 } = {}) {
  const gone = new Set(dismissed);
  const q = norm(search);
  const all = [];
  for (const c of connections) {
    if (q && !norm(`${c.name} ${c.company} ${c.position}`).includes(q)) continue;
    const s = scoreConnection(c, ctx);
    all.push({ ...c, ...s, isLead: inSet(leadKeys, c), dismissed: gone.has(c.id) });
  }
  all.sort((a, b) => b.score - a.score || (b.connectedOn || "").localeCompare(a.connectedOn || ""));
  const visible = all.filter((c) => !c.dismissed);
  const counts = { total: connections.length, matched: all.length, strong: visible.filter((c) => c.tier === "strong").length, good: visible.filter((c) => c.tier === "good").length, atTargets: visible.filter((c) => c.companyKey).length, sameField: visible.filter((c) => c.tags.includes("same field")).length, recruiters: visible.filter((c) => c.tags.includes("recruiter")).length, dismissed: all.length - visible.length };
  // When searching, show whatever matches; otherwise leave out people with no signal at all.
  const shown = (q ? all : visible.filter((c) => c.score >= 15)).slice(0, limit);
  return { items: shown, counts };
}

/** Keys that identify a person: profile URL when known, and name + company. */
export function personKeys(p) {
  const keys = [`${norm(p.name)}|${companyKey(p.company)}`];
  if (p.url) keys.push(p.url.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, ""));
  return keys;
}
const keySet = (people) => new Set(people.flatMap(personKeys));
const inSet = (set, p) => personKeys(p).some((k) => set.has(k));

// ---------- Lead quality ----------

export const RELATIONSHIPS = ["Friend / close contact", "Former colleague", "Classmate / alumni", "Met in person", "LinkedIn connection", "Community member", "Mutual connection", "Cold (no link yet)"];
const WARMTH = { "Friend / close contact": 30, "Former colleague": 26, "Classmate / alumni": 18, "Met in person": 16, "LinkedIn connection": 14, "Community member": 12, "Mutual connection": 8, "Cold (no link yet)": 3 };
export const LEAD_STATUSES = ["new", "researching", "reached out", "replied", "talking", "referred", "dormant", "dead"];
const INFLUENCE = { "hiring manager": 25, recruiter: 14, "team member": 18, "peer in field": 14, leader: 12, other: 5 };

/**
 * Lead quality 0-100 from four things: how warm the relationship is, whether they
 * are at a company you're pursuing, how much say they have in hiring, and whether
 * the conversation is moving. Your own rating nudges it (and "not a fit" caps it).
 */
export function leadQuality(lead, ctx) {
  const reasons = [];
  const co = matchCompany(lead.company, ctx);
  const auto = roleType(lead.title, ctx.field);
  const role = lead.roleType && lead.roleType !== "auto" ? lead.roleType : auto.type;

  const warmth = WARMTH[lead.relationship] ?? 8;
  reasons.push(warmth >= 26 ? `warm relationship (${lead.relationship.toLowerCase()})` : warmth >= 12 ? `some connection (${(lead.relationship || "unknown").toLowerCase()})` : "cold contact: needs rapport first");

  let access = 0;
  if (co?.level === "active") { access = 35; reasons.push(`at ${co.name}, where you've ${co.jobs.find((j) => ACTIVE.has(j.status))?.status === "interviewing" ? "got an interview" : "applied"}`); }
  else if (co?.level === "saved") { access = 28; reasons.push(`at ${co.name}, where you have a job saved`); }
  else if (co) { access = 22; reasons.push(`at ${co.name}, on your target list`); }
  else if (role === "recruiter") { access = 12; reasons.push("recruiter: can open doors at several companies"); }
  else if (lead.company) { access = 5; reasons.push(`${lead.company} isn't a company you're tracking yet`); }

  let influence = INFLUENCE[role] ?? 5;
  if (role === "recruiter" && co) influence = 20;
  if (role === "hiring manager") reasons.push("likely has a say in hiring for your kind of role");
  else if (role === "team member") reasons.push("on the team: referrals from teammates carry weight");
  else if (role === "peer in field") reasons.push("works in your field: can vouch for your craft");

  let momentum = 0;
  const lastAt = lead.lastContactAt ? Date.parse(lead.lastContactAt) : 0;
  const quietDays = lastAt ? Math.floor((ctx.now - lastAt) / DAY) : null;
  if (lead.status === "referred") { momentum = 15; reasons.push("already referred or introduced you"); }
  else if (lead.status === "talking") { momentum = 12; reasons.push("you're in conversation"); }
  else if (lead.status === "replied") { momentum = 8; reasons.push("they replied"); }
  else if (lead.status === "reached out" && quietDays != null && quietDays > 14) { momentum = -8; reasons.push(`no reply in ${quietDays} days`); }
  else if (lead.status === "dormant") { momentum = -10; reasons.push("gone quiet"); }
  else if (lead.status === "dead") { momentum = -40; reasons.push("marked as a dead end"); }

  let score = warmth + access + influence + momentum + (lead.rating === "good" ? 8 : 0);
  if (lead.rating === "not") { score = Math.min(score, 15); reasons.push("you marked this lead as not a fit"); }
  else if (lead.rating === "good") reasons.push("you marked this lead as good");
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = score >= 65 ? "High" : score >= 40 ? "Medium" : "Low";
  return { score, tier, reasons, parts: { warmth, access, influence, momentum }, roleType: role, companyKey: co?.key || "", companyLevel: co?.level || "", jobs: co ? co.jobs.slice(0, 4) : [], quietDays, nextStep: nextStep(lead, { co, role, quietDays }) };
}

function nextStep(lead, { co, role, quietDays }) {
  const job = co?.jobs.find((j) => ACTIVE.has(j.status)) || co?.jobs[0];
  const about = job ? ` about ${job.title || "the role"}` : "";
  if (lead.rating === "not" || lead.status === "dead") return "No action. Leave it.";
  switch (lead.status) {
    case "new":
    case "researching":
      return (WARMTH[lead.relationship] ?? 8) >= 16 ? `Message them directly${about}: say what you're looking at and ask for their read on the team.` : `Find one specific thing about their work, then send a short first note${co ? "" : " (no ask yet)"}.`;
    case "reached out":
      if (quietDays != null && quietDays >= 21) return "Two attempts is enough. Mark as dormant and move on.";
      if (quietDays != null && quietDays >= 7) return "Send one short, friendly follow-up. People miss messages.";
      return "Wait. Give them about a week before following up.";
    case "replied":
      return `Reply within a day and suggest a 15-minute chat${about}.`;
    case "talking":
      return job && ACTIVE.has(job.status) ? `Tell them you applied for ${job.title} and ask if they'd be comfortable referring you or pointing you to the hiring manager.` : job ? `Ask if they'd refer you for ${job.title} before you apply; referrals usually have to come first.` : role === "recruiter" ? "Share your reel/resume and the roles you want, and ask what they're hiring for." : "Ask who else you should talk to, and keep them posted.";
    case "referred":
      return "Thank them, and tell them how it goes. Follow up with the recruiter if a week passes.";
    case "dormant":
      return "Revisit only if something new comes up (a new role there, new work to share).";
    default:
      return "";
  }
}

// ---------- Company map ----------

/** For each company you're pursuing: your jobs there, your leads, and connections you haven't used yet. */
export function companyMap(ctx, leads, connections = []) {
  const byCo = new Map();
  const slot = (k, name) => {
    if (!byCo.has(k)) byCo.set(k, { key: k, name, jobs: [], level: "none", leads: [], connections: [], connectionCount: 0 });
    return byCo.get(k);
  };
  for (const c of ctx.companies.values()) Object.assign(slot(c.key, c.name), { jobs: c.jobs, level: c.level });
  const leadKeys = keySet(leads);
  for (const l of leads) {
    const co = matchCompany(l.company, ctx);
    const k = co?.key || companyKey(l.company);
    if (!k) continue;
    slot(k, co?.name || l.company).leads.push({ id: l.id, name: l.name, title: l.title || "", status: l.status, rating: l.rating || "", score: l.quality?.score ?? 0 });
  }
  for (const c of connections) {
    const co = matchCompany(c.company, ctx);
    if (!co || inSet(leadKeys, c)) continue;
    const s = byCo.get(co.key);
    s.connectionCount++;
    if (s.connections.length < 6) s.connections.push({ id: c.id, name: c.name, position: c.position || "", roleType: roleType(c.position, ctx.field).type });
  }
  const rank = { active: 3, saved: 2, target: 1, none: 0 };
  const out = [...byCo.values()].map((c) => {
    c.leads.sort((a, b) => b.score - a.score);
    const usable = c.leads.filter((l) => l.rating !== "not" && l.status !== "dead");
    c.heat = rank[c.level] * 20 + Math.min(30, usable.length * 12) + Math.min(10, c.connectionCount * 3);
    c.coverage = usable.length ? (usable.some((l) => ["talking", "referred", "replied"].includes(l.status)) ? "in conversation" : "have leads") : c.connectionCount ? "connections not used yet" : "no contacts";
    c.nextMove = companyMove(c, usable);
    return c;
  });
  return out.sort((a, b) => b.heat - a.heat || a.name.localeCompare(b.name));
}

function companyMove(c, usable) {
  const job = c.jobs.find((j) => ACTIVE.has(j.status)) || c.jobs[0];
  const best = usable[0];
  if (job && ACTIVE.has(job.status)) {
    if (best && ["talking", "replied", "referred"].includes(best.status)) return `You applied for ${job.title}. Tell ${best.name} and ask if they can flag your application to the hiring manager.`;
    if (best) return `You applied for ${job.title}. Reach out to ${best.name} now: a note from inside in the first week helps most.`;
    if (c.connectionCount) return `You applied for ${job.title} and already know ${c.connectionCount} ${c.connectionCount === 1 ? "person" : "people"} here. Add one as a lead and message them.`;
    return `You applied for ${job.title} with no contact here yet. Build a referral plan to find the hiring manager or a teammate.`;
  }
  if (job) {
    if (best) return `Before applying for ${job.title}, ask ${best.name} about the team. Referrals usually have to be submitted before you apply.`;
    if (c.connectionCount) return `You know ${c.connectionCount} ${c.connectionCount === 1 ? "person" : "people"} here. Talk to one before applying for ${job.title}.`;
    return `No contacts yet for ${job.title}. Build a referral plan, or apply and follow up with a recruiter.`;
  }
  if (best) return `No open role tracked. Ask ${best.name} what the team is hiring for next, and watch their careers page.`;
  if (c.connectionCount) return `On your target list, and you know ${c.connectionCount} ${c.connectionCount === 1 ? "person" : "people"} here. Add one as a lead.`;
  return "On your target list. Add their careers board in Settings and look for people to meet.";
}

// ---------- One call that computes everything the Networking tab shows ----------

export function overview({ profile, focus, skills, tracker, savedJobs, workingJob, leadsStore = {}, connections = [], pastEmployers = [], search = "" }) {
  const ctx = buildContext({ profile, focus, skills, tracker, savedJobs, workingJob, targets: leadsStore.targets || [], pastEmployers });
  const leads = (leadsStore.items || []).map((l) => ({ ...l, quality: leadQuality(l, ctx) }));
  const leadKeys = keySet(leads);
  const ranked = rankConnections(connections, ctx, { dismissed: leadsStore.dismissed || [], leadKeys, search });
  const today = new Date(ctx.now).toISOString().slice(0, 10);
  const live = leads.filter((l) => l.rating !== "not" && l.status !== "dead");
  return {
    quality: Object.fromEntries(leads.map((l) => [l.id, l.quality])),
    suggestions: ranked.items,
    connectionCounts: ranked.counts,
    companies: companyMap(ctx, leads, connections),
    stats: {
      leads: leads.length,
      high: live.filter((l) => l.quality.tier === "High").length,
      due: live.filter((l) => l.nextActionAt && l.nextActionAt <= today).length,
      waiting: live.filter((l) => l.status === "reached out").length,
      talking: live.filter((l) => ["replied", "talking"].includes(l.status)).length,
      referred: leads.filter((l) => l.status === "referred").length,
    },
  };
}
