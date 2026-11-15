// Seniority levels for job postings. Used by the Jobs filter.
// Title wins (it's the clearest signal), then the posting's own seniority field,
// then "N years of experience" wording in the description.

export const LEVELS = [
  { id: "intern", label: "Internship", rank: 0 },
  { id: "entry", label: "Entry / junior", rank: 1 },
  { id: "mid", label: "Mid-level", rank: 2 },
  { id: "senior", label: "Senior", rank: 3 },
  { id: "lead", label: "Lead / principal", rank: 4 },
  { id: "director", label: "Director / head of", rank: 5 },
  { id: "exec", label: "VP / executive", rank: 6 },
];
export const levelById = (id) => LEVELS.find((l) => l.id === id);

const T = [
  ["intern", /\b(intern|internship|apprentice|trainee|working student|co-?op)\b/],
  ["exec", /\b(vp|svp|evp|vice president|chief|president|c-?level|cmo|cto|coo|ceo)\b/],
  ["lead", /\b(art director|creative director|associate creative director|design director|principal|staff|distinguished|architect|lead)\b/],
  ["director", /\b(director|head of|head,|general manager)\b/],
  ["senior", /\b(senior|sr\.?|sr)\b|\b(iii|iv|v)\b|\blevel (3|4|5)\b/],
  ["entry", /\b(junior|jr\.?|entry[- ]level|associate|assistant|coordinator|graduate|early[- ]career|new grad|level 1)\b/],
  ["mid", /\b(mid[- ]?level|intermediate|ii|level 2)\b/],
];
const FIELD = [["intern", /intern/], ["exec", /exec|c-?level|vp/], ["director", /director|head/], ["lead", /lead|principal|staff/], ["senior", /senior|sr/], ["entry", /entry|junior|jr|graduate/], ["mid", /mid|intermediate/]];

const cache = new WeakMap();

/** @returns {{id: string, rank: number|null, label: string, why: string}} id is "unknown" when nothing says. */
export function levelOf(job) {
  if (cache.has(job)) return cache.get(job);
  const out = classify(job);
  cache.set(job, out);
  return out;
}

function classify(job) {
  const title = String(job.title || "").toLowerCase();
  const done = (id, why) => ({ id, rank: levelById(id).rank, label: levelById(id).label, why });
  for (const [id, re] of T) if (re.test(title)) return done(id, "from the job title");
  const field = (Array.isArray(job.seniority) ? job.seniority.join(" ") : String(job.seniority || "")).toLowerCase();
  if (field) for (const [id, re] of FIELD) if (re.test(field)) return done(id, "from the posting's level");
  const text = `${job.description || ""}`.slice(0, 6000).toLowerCase();
  if (/\bentry[- ]level\b|\bno experience (needed|required)\b|\brecent graduate\b/.test(text)) return done("entry", "posting says entry-level");
  let years = 0;
  for (const m of text.matchAll(/(\d{1,2})\s*(?:\+|-\s*\d{1,2}|to\s*\d{1,2})?\s*years?(?:['’]s)?\s*(?:of\s*)?(?:[a-z/&-]+\s+){0,3}experience/g)) years = Math.max(years, +m[1]);
  if (years) return done(years <= 2 ? "entry" : years <= 4 ? "mid" : years <= 9 ? "senior" : "lead", `asks for ${years}+ years of experience`);
  // A plain "Manager" title (Social Media Manager, Content Manager) is usually an individual role, so call it mid-level.
  if (/\bmanager\b/.test(title)) return done("mid", "manager title (usually an individual role)");
  return { id: "unknown", rank: null, label: "Level not stated", why: "no level in title or posting" };
}

/** The highest level a focus's "seniority" text allows, or "any". e.g. "mid / senior" → "senior". */
export function maxLevelFromText(text = "") {
  const t = String(text).toLowerCase(); let best = null;
  for (const [id, re] of FIELD) if (re.test(t)) { const r = levelById(id).rank; if (best == null || r > best) best = r; }
  return best == null ? "any" : LEVELS.find((l) => l.rank === best).id;
}

/** Should a job be shown? opts: { maxLevel: id|"any", hideIntern, showUnknown } */
export function passesLevel(job, { maxLevel = "any", hideIntern = false, showUnknown = true } = {}) {
  const lv = levelOf(job);
  if (lv.id === "unknown") return showUnknown;
  if (hideIntern && lv.id === "intern") return false;
  if (maxLevel === "any") return true;
  return lv.rank <= levelById(maxLevel).rank;
}
