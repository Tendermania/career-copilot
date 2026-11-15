// Fit scoring: how well one posting suits the person, judged on seven separate things rather than
// keyword overlap alone. Each factor has its own maximum, a score and a one-line reason, so the UI can
// show exactly where a number came from.
//
//   Role match      30   is this the job you're actually looking for (title, not just mentions)
//   Skills & tools  25   what they require vs. what you have; "required" counts more than "nice to have"
//   Level           15   their seniority and years asked vs. yours
//   Work setup      10   remote / hybrid / on-site and location vs. your preferences
//   Job type         8   full-time / contract / freelance… vs. your preferences
//   Pay              7   the stated pay vs. your minimum
//   Industry         5   their field vs. your focus's industries
//
// Things the posting doesn't say score in the middle (never zero), and a posting whose title is a
// different job is capped however many of your tools it mentions.
import { norm, findSkills, containsTerm, SKILLS } from "./text.js";
import { levelOf, LEVELS } from "../public/level.js";
import { parsePay, parseMinPay } from "./pay.js";

export const FACTORS = [
  { id: "role", label: "Role match", max: 30 },
  { id: "skills", label: "Skills & tools", max: 25 },
  { id: "level", label: "Level", max: 15 },
  { id: "setup", label: "Work setup", max: 10 },
  { id: "type", label: "Job type", max: 8 },
  { id: "pay", label: "Pay", max: 7 },
  { id: "industry", label: "Industry", max: 5 },
];

// ---------- role ----------
const LEVEL_WORDS = new Set("senior sr junior jr lead principal staff head director associate assistant intern internship mid midlevel level entry i ii iii iv v freelance contract contractor remote hybrid parttime fulltime part full time temporary temp m f d w x".split(" "));
const HEAD_FAMILIES = [
  ["designer", "artist", "animator", "illustrator", "creative"],
  ["engineer", "developer", "programmer", "architect"],
  ["manager", "lead", "director", "head", "supervisor"],
  ["editor", "producer", "videographer", "filmmaker"],
  ["writer", "copywriter", "author"],
  ["analyst", "scientist", "researcher"],
  ["marketer", "specialist", "coordinator", "strategist", "associate", "generalist"],
  ["recruiter", "sourcer"], ["representative", "agent", "advisor", "consultant"], ["teacher", "instructor", "tutor", "trainer"],
];
const HEADS = new Map(HEAD_FAMILIES.flatMap((f, i) => f.map((w) => [w, i])));
const stem = (w) => w.replace(/(ers?|ors?|ing|ion|ions|ics|s)$/, "").replace(/(.)\1$/, "$1");
function titleTokens(title) {
  const t = norm(String(title).replace(/\([^)]*\)/g, " ").split(/\s[-–—|@]\s|,/)[0] || title).replace(/[/.+#]/g, " ");
  return t.split(" ").filter((w) => w && !LEVEL_WORDS.has(w) && !/^\d+$/.test(w));
}
function roleSim(titleToks, role) {
  const rt = titleTokens(role);
  if (!rt.length) return { sim: 0 };
  const tStem = new Set(titleToks.map(stem));
  const rHead = rt.filter((w) => HEADS.has(w)), tHead = titleToks.filter((w) => HEADS.has(w));
  const rDisc = rt.filter((w) => !HEADS.has(w));
  // "designer" in the role counts as covered by "design" in the title and vice versa
  const cover = rDisc.length ? rDisc.filter((w) => tStem.has(stem(w))).length / rDisc.length : 0;
  let head = 0.5; // unknown
  if (rHead.length && tHead.length) head = rHead.some((h) => tHead.includes(h)) ? 1 : rHead.some((h) => tHead.some((x) => HEADS.get(x) === HEADS.get(h))) ? 0.75 : 0;
  else if (rHead.length && rHead.some((h) => tStem.has(stem(h)))) head = 1;
  if (!rDisc.length) return { sim: head === 1 ? 0.9 : head * 0.5, headClash: head === 0 };
  const sim = cover * 0.7 + head * 0.3 * (cover > 0 ? 1 : 0.3);
  return { sim, headClash: head === 0 && cover > 0, otherHead: tHead[0] };
}
function roleFactor(j, p) {
  const roles = (p.targetRoles || []).filter(Boolean);
  if (!roles.length) return { ratio: 0.6, note: "No target roles set in your focus" };
  const tn = norm(j.title), toks = titleTokens(j.title);
  let best = { sim: 0, role: "" };
  for (const r of roles) {
    const rn = norm(r);
    const s = tn.includes(rn) ? { sim: 1 } : roleSim(toks, r);
    if (s.sim > best.sim) best = { ...s, role: r };
  }
  if (best.sim >= 0.95) return { ratio: 1, note: `Title is your target role “${best.role}”`, good: true };
  if (best.headClash) return { ratio: Math.min(0.5, best.sim), note: `Related to “${best.role}”, but the title is a ${best.otherHead} role`, bad: true };
  if (best.sim >= 0.7) return { ratio: 0.85, note: `Title is close to “${best.role}”`, good: true };
  if (best.sim >= 0.4) return { ratio: 0.55, note: `Title partly overlaps “${best.role}”` };
  // Title is something else: does the posting at least describe your kind of work?
  const body = norm(String(j.description || "").slice(0, 6000));
  const mentions = roles.filter((r) => containsTerm(body, r)).length;
  if (mentions) return { ratio: 0.3, note: "A different job title; your role is only mentioned in the posting", bad: true };
  return { ratio: best.sim >= 0.2 ? 0.2 : 0.05, note: "Title doesn't match any of your target roles", bad: true };
}

// ---------- skills ----------
const PREF_HEAD = /nice[- ]to[- ]haves?|preferred|bonus|pluses|\ba plus\b|not required|extra credit|would be great|desirable|ideally/i;
const REQ_HEAD = /requirements?|qualifications|must[- ]haves?|what you.ll (?:need|bring)|what we.re looking for|you have|you are|required|essential|minimum|who you are|about you|skills/i;
/** Split a posting into required / preferred / general text. */
export function segments(description) {
  const out = { required: "", preferred: "", general: "" };
  let mode = "general";
  for (const raw of String(description || "").split(/\n+/)) {
    const line = raw.trim(); if (!line) continue;
    const heading = line.length < 70 && !/^[•\-*–]/.test(line);
    if (heading && PREF_HEAD.test(line)) { mode = "preferred"; continue; }
    if (heading && REQ_HEAD.test(line)) { mode = "required"; continue; }
    if (heading && /responsibilit|what you.ll do|the role|about (?:us|the)|benefits|perks|we offer|compensation|how to apply/i.test(line)) { mode = "general"; continue; }
    const inline = /\b(nice to have|is a plus|a plus\b|bonus points|preferred but|ideally|not required)\b/i.test(line) ? "preferred" : /\b(must have|required|you must|need to have|minimum of)\b/i.test(line) ? "required" : mode;
    out[inline] += line + "\n";
  }
  return out;
}
function skillsFactor(j, p) {
  // your target roles imply their own craft (a Video Editor has "video editing")
  const mine = new Set([...(p.skills || []), ...findSkills((p.targetRoles || []).join(", "))]);
  const myKw = (p.keywords || []).filter(Boolean);
  const seg = segments(j.description);
  const titleN = norm(j.title), all = norm(`${j.title} ${j.description}`);
  const weights = new Map(); // skill -> {w, where}
  const add = (s, w, where) => { const e = weights.get(s); if (!e || w > e.w) weights.set(s, { w, where }); };
  for (const s of findSkills(seg.general)) add(s, 0.7, "mentioned");
  for (const s of findSkills(seg.preferred)) add(s, 0.35, "nice to have");
  for (const s of findSkills(seg.required)) add(s, 1, "required");
  for (const s of findSkills(j.title)) add(s, 1.4, "in the title");
  // your own focus keywords that aren't in the built-in vocabulary still count when the posting asks for them
  const canon = new Set(Object.keys(SKILLS).map((k) => k.toLowerCase()));
  for (const k of myKw) if (!canon.has(k.toLowerCase()) && !findSkills(k).length && containsTerm(all, k)) { add(k, containsTerm(titleN, k) ? 1.4 : 0.8, "mentioned"); mine.add(k); }
  // emphasis: tools they keep repeating matter more
  for (const [s, e] of weights) { const names = [s, ...(SKILLS[s] || [])].map(norm); const n = names.reduce((a, t) => a + (all.split(t).length - 1), 0); if (n >= 3) e.w += 0.3; else if (n === 2) e.w += 0.15; }
  const list = [...weights.entries()];
  if (!list.length) return { ratio: 0.55, note: "Posting names no specific tools or skills", jobSkills: [], missing: [], missingRequired: [] };
  const total = list.reduce((a, [, e]) => a + e.w, 0);
  const have = list.filter(([s]) => mine.has(s));
  const got = have.reduce((a, [, e]) => a + e.w, 0);
  const missing = list.filter(([s]) => !mine.has(s)).sort((a, b) => b[1].w - a[1].w);
  const missingRequired = missing.filter(([, e]) => e.w >= 1).map(([s]) => s);
  const conf = Math.min(1, total / 3); // one lone skill shouldn't swing the score
  const ratio = (got / total) * conf + 0.55 * (1 - conf);
  const note = `${have.length} of ${list.length} skills they name${missingRequired.length ? `; missing required: ${missingRequired.slice(0, 3).join(", ")}` : missing.length ? `; missing: ${missing.slice(0, 3).map(([s]) => s).join(", ")}` : ""}`;
  return { ratio, note, good: ratio >= 0.75, bad: ratio < 0.4 || missingRequired.length >= 2, jobSkills: list.map(([s]) => s), have: have.map(([s]) => s), missing: missing.map(([s]) => s), missingRequired };
}

// ---------- level ----------
const MONTHS = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
/** Years of work experience from the date ranges on a resume (education lines skipped, overlaps merged). */
export function experienceYears(resumeText) {
  const now = new Date().getFullYear() + new Date().getMonth() / 12;
  const spans = [];
  for (const line of String(resumeText || "").split(/\n/)) {
    if (/university|college|bachelor|master of|\bb\.?f?\.?a\b|\bb\.?s\.?c?\b|\bm\.?f?\.?a\b|degree|diploma|high school|academy|certificat/i.test(line)) continue;
    for (const m of line.matchAll(new RegExp(`(?:${MONTHS}\\s+|\\d{1,2}/)?((?:19|20)\\d{2})\\s*(?:-|–|—|to|until)\\s*(?:(?:${MONTHS}\\s+|\\d{1,2}/)?((?:19|20)\\d{2})|(present|current|now|today|ongoing))`, "gi"))) {
      const a = Number(m[1]), b = m[3] ? now : Number(m[2]) + 0.5;
      if (a >= 1975 && b >= a && b <= now + 1) spans.push([a, Math.max(b, a + 0.5)]);
    }
  }
  if (!spans.length) return null;
  spans.sort((x, y) => x[0] - y[0]);
  let total = 0, [s, e] = spans[0];
  for (const [a, b] of spans.slice(1)) { if (a <= e) e = Math.max(e, b); else { total += e - s; [s, e] = [a, b]; } }
  return Math.round((total + e - s) * 10) / 10;
}
export function yearsAsked(description) {
  let years = 0;
  for (const m of String(description || "").slice(0, 8000).toLowerCase().matchAll(/(\d{1,2})\s*(?:\+|-\s*\d{1,2}|to\s*\d{1,2})?\s*years?(?:['’]s)?\s*(?:of\s*)?(?:[a-z/&-]+\s+){0,3}experience/g)) if (+m[1] < 25) years = Math.max(years, +m[1]);
  return years || null;
}
const rankFromYears = (y) => (y < 2 ? 1 : y < 5 ? 2 : y < 9 ? 3 : 4);
function myLevel(p) {
  const t = String(p.seniorityText || "").toLowerCase();
  const ranks = [];
  for (const [re, r] of [[/intern/, 0], [/entry|junior|jr|graduate/, 1], [/mid|intermediate/, 2], [/senior|sr/, 3], [/lead|principal|staff/, 4], [/director|head/, 5], [/exec|vp|c-?level/, 6]]) if (re.test(t)) ranks.push(r);
  if (ranks.length) return { min: Math.min(...ranks), max: Math.max(...ranks), from: "your focus's seniority" };
  if (p.years != null) { const r = rankFromYears(p.years); return { min: r, max: r, from: `about ${Math.round(p.years)} years on your resume` }; }
  return null;
}
function levelFactor(j, p) {
  const lv = levelOf(j), asked = yearsAsked(j.description), me = myLevel(p);
  const label = (r) => (LEVELS.find((l) => l.rank === r) || {}).label || "";
  if (!me) return { ratio: 0.6, note: lv.id === "unknown" ? "Level not stated" : `${lv.label} role; add a resume or a seniority to your focus to compare` };
  let ratio, note;
  if (lv.id === "unknown") { ratio = 0.65; note = "Posting doesn't state a level"; }
  else if (lv.rank >= me.min && lv.rank <= me.max) { ratio = 1; note = `${lv.label} role, right at your level`; }
  else if (lv.rank > me.max) { const d = lv.rank - me.max; ratio = d === 1 ? 0.55 : d === 2 ? 0.2 : 0.05; note = d === 1 ? `${lv.label} role: one step above ${label(me.max).toLowerCase()}, a stretch` : `${lv.label} role, well above your level`; }
  else { const d = me.min - lv.rank; ratio = lv.rank === 0 ? 0.1 : d === 1 ? 0.8 : 0.4; note = lv.rank === 0 ? "Internship, below your level" : d === 1 ? `${lv.label} role, a step below your level` : `${lv.label} role, well below your level`; }
  if (asked && p.years != null) {
    const short = asked - p.years;
    if (short > 2.5) { ratio *= 0.55; note += `; asks ${asked}+ years, you show about ${Math.round(p.years)}`; }
    else if (short > 0.5) { ratio *= 0.82; note += `; asks ${asked}+ years, you show about ${Math.round(p.years)}`; }
    else note += `; you meet the ${asked}+ years asked`;
  } else if (asked) note += `; asks ${asked}+ years`;
  return { ratio, note, good: ratio >= 0.8, bad: ratio < 0.4 };
}

// ---------- setup, type, pay, industry ----------
const placeTokens = (s) => norm(String(s || "").replace(/\b(remote|hybrid|on-?site|only|anywhere|worldwide|area|greater|metro)\b/gi, " ")).split(/[ /]/).filter((w) => w.length > 1);
const REGIONS = { us: ["us", "usa", "united", "states", "america", "americas", "north"], uk: ["uk", "united", "kingdom", "england", "britain", "emea", "europe"], eu: ["europe", "eu", "emea", "european"], ca: ["canada", "americas", "north"] };
function placesOverlap(a, b) {
  const A = new Set(placeTokens(a)), B = placeTokens(b);
  if (!A.size || !B.length) return null;
  if (B.some((w) => A.has(w))) return true;
  const usStates = /\b(a[lkzr]|c[aot]|de|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy]|nyc|sf|la)\b/;
  const isUS = (t) => usStates.test(t) || REGIONS.us.some((w) => t.split(" ").includes(w));
  if (isUS(norm(a)) && isUS(norm(b))) return "country";
  return false;
}
export function workplaceOf(j) {
  const t = `${j.location || ""} ${j.title || ""} ${String(j.description || "").slice(0, 1500)}`;
  if (/\bhybrid\b/i.test(`${j.location} ${j.title}`)) return "Hybrid";
  if (j.remote) return "Remote";
  if (/\bhybrid\b/i.test(t)) return "Hybrid";
  return "On-site";
}
function setupFactor(j, p) {
  const prefs = p.prefs?.workplace || [], kind = workplaceOf(j), mine = [p.prefs?.locations, p.homeLocation].filter(Boolean).join(", ");
  if (kind === "Remote") {
    const loc = String(j.location || "");
    const restricted = loc && !/^(remote|anywhere|worldwide|global|international)\b/i.test(loc.trim()) && placeTokens(loc).length;
    const ok = !prefs.length || prefs.includes("Remote");
    if (!ok) return { ratio: 0.5, note: "Remote, and you didn't tick remote in Preferences" };
    if (restricted && mine) { const o = placesOverlap(mine, loc); if (o === false) return { ratio: 0.5, note: `Remote, but limited to ${loc.slice(0, 40)}: check you're eligible` }; }
    return { ratio: 1, note: restricted ? `Remote (${loc.slice(0, 40)})` : "Remote", good: true };
  }
  if (prefs.length && !prefs.includes(kind)) return { ratio: 0.12, note: `${kind}${j.location ? ` in ${String(j.location).slice(0, 40)}` : ""}; you prefer ${prefs.join(" / ").toLowerCase()}`, bad: true };
  if (!j.location) return { ratio: 0.6, note: `${kind}, location not given` };
  if (!mine) return { ratio: 0.65, note: `${kind} in ${String(j.location).slice(0, 40)}; add your location in Profile to compare` };
  const o = placesOverlap(mine, j.location);
  if (o === true) return { ratio: 1, note: `${kind} in ${String(j.location).slice(0, 40)}, one of your locations`, good: true };
  return { ratio: o === "country" ? 0.35 : 0.2, note: `${kind} in ${String(j.location).slice(0, 40)}, outside your locations`, bad: true };
}
function typeFactor(j, p) {
  const prefs = p.prefs?.types || [];
  if (!j.type || j.type === "Unspecified") return { ratio: 0.6, note: "Job type not stated" };
  if (!prefs.length) return { ratio: 0.7, note: j.type };
  return prefs.includes(j.type) ? { ratio: 1, note: `${j.type}, a type you want`, good: true } : { ratio: 0.12, note: `${j.type}; you're looking for ${prefs.join(", ").toLowerCase()}`, bad: true };
}
function payFactor(j, p) {
  const pay = j.pay || parsePay(j), min = parseMinPay(p.prefs?.minPay);
  if (pay.min == null) return { ratio: 0.5, note: pay.kind === "unknown" ? "Pay not listed" : `Pay not listed (likely ${pay.label.toLowerCase()})` };
  const wantAnnual = min.salary ?? min.salaryFromHourly, wantSame = min[pay.kind];
  if (wantAnnual == null && wantSame == null) return { ratio: 0.8, note: `${pay.label}: ${pay.text}. Set a minimum in Preferences to compare` };
  if (pay.currency && pay.currency !== "USD" && !String(p.prefs?.minPay || "").match(/[£€]|eur|gbp|cad|aud/i)) return { ratio: 0.65, note: `${pay.label}: ${pay.text} (different currency from your minimum)` };
  const same = wantSame != null;
  const lo = same ? pay.min : pay.annualMin, hi = same ? pay.max || pay.min : pay.annualMax || pay.annualMin, want = same ? wantSame : wantAnnual;
  if (lo == null || want == null) return { ratio: 0.7, note: `${pay.label}: ${pay.text}` };
  const est = pay.estimated ? " (the board's estimate)" : "";
  if (lo >= want) return { ratio: 1, note: `${pay.label}: ${pay.text}${est}, at or above your minimum`, good: true };
  if (hi >= want) return { ratio: 0.85, note: `${pay.label}: ${pay.text}${est}; the top of the range meets your minimum`, good: true };
  if (hi >= want * 0.9) return { ratio: 0.5, note: `${pay.label}: ${pay.text}${est}, just under your minimum` };
  return { ratio: 0.08, note: `${pay.label}: ${pay.text}${est}, below your minimum`, bad: true };
}
const INDUSTRY_WORDS = { tech: ["software", "saas", "tech", "startup", "platform", "app"], games: ["game", "games", "gaming", "esports"], gaming: ["game", "games", "gaming", "esports"], broadcast: ["broadcast", "tv", "television", "network", "sports", "news"], advertising: ["advertising", "agency", "campaign", "brand", "commercial"], saas: ["saas", "software", "b2b"], fintech: ["fintech", "finance", "bank", "payments", "trading"], "health tech": ["health", "healthcare", "medical", "wellness"], edtech: ["education", "learning", "edtech", "students"], ecommerce: ["ecommerce", "e-commerce", "retail", "shop", "dtc"], "consumer brands": ["consumer", "brand", "retail", "dtc", "cpg"], "creator economy": ["creator", "creators", "influencer"] };
function industryFactor(j, p) {
  const inds = (p.industries || []).filter(Boolean);
  if (!inds.length) return { ratio: 0.6, note: "No industries set in your focus" };
  const hay = norm(`${j.company} ${(j.tags || []).join(" ")} ${String(j.description || "").slice(0, 4000)}`);
  const hit = inds.filter((i) => [i, ...(INDUSTRY_WORDS[i.toLowerCase()] || [])].some((w) => containsTerm(hay, w)));
  if (hit.length) return { ratio: 1, note: `In ${hit.slice(0, 2).join(" / ")}, an industry you target`, good: true };
  return { ratio: String(j.description || "").length < 400 ? 0.5 : 0.3, note: "Not clearly in your target industries" };
}

// ---------- total ----------
/**
 * @param {object} j a normalized job (needs title, description, type, flags; pay is computed if absent)
 * @param {object} p {targetRoles, keywords, avoidKeywords, skills, industries, seniorityText, years, homeLocation, prefs:{workplace, types, minPay, locations}}
 */
export function scoreFit(j, p = {}) {
  const parts = { role: roleFactor(j, p), skills: skillsFactor(j, p), level: levelFactor(j, p), setup: setupFactor(j, p), type: typeFactor(j, p), pay: payFactor(j, p), industry: industryFactor(j, p) };
  const breakdown = FACTORS.map((f) => { const r = parts[f.id]; return { id: f.id, label: f.label, max: f.max, points: Math.round(Math.max(0, Math.min(1, r.ratio)) * f.max), note: r.note, tone: r.good ? "good" : r.bad ? "bad" : "" }; });
  let score = breakdown.reduce((a, b) => a + b.points, 0);
  const concerns = [], adjustments = [];
  const text = norm(`${j.title} ${j.description}`);
  const avoid = (p.avoidKeywords || []).filter((k) => k && containsTerm(text, k));
  if (avoid.length) { const n = Math.min(30, avoid.length * 12); score -= n; adjustments.push({ label: `Contains words you avoid: ${avoid.join(", ")}`, points: -n }); }
  if ((j.flags || []).some((f) => f.level === "danger")) { score -= 25; adjustments.push({ label: "Scam-like wording in the posting", points: -25 }); }
  if ((j.flags || []).some((f) => f.level === "warn")) { score -= 10; adjustments.push({ label: "Mentions unpaid or spec work", points: -10 }); }
  // The title is a different job: tools in common don't make it a match.
  if (parts.role.ratio < 0.35 && score > 40) { adjustments.push({ label: "Capped: the title isn't one of your target roles", points: 40 - score }); score = 40; }
  for (const b of breakdown) if (b.tone === "bad") concerns.push(b.note);
  for (const a of adjustments) if (!/^Capped/.test(a.label)) concerns.push(a.label);
  const why = breakdown.filter((b) => b.tone === "good").sort((a, b) => b.max - a.max).map((b) => b.note);
  const thin = String(j.description || "").length < 300;
  return {
    score: Math.max(0, Math.min(100, Math.round(score))), why, concerns, breakdown, adjustments,
    confidence: thin ? "low" : "normal", confidenceNote: thin ? "The listing gives very little text, so this score is a rough guess. Open the posting for the full picture." : "",
    jobSkills: parts.skills.jobSkills, missingSkills: parts.skills.missing, missingRequired: parts.skills.missingRequired,
  };
}
