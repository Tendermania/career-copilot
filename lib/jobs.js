// Job search across many boards. Each adapter returns normalized jobs; the
// aggregator dedupes, drops stale/expired postings, classifies job type,
// flags risks, and ranks by fit to the active profile/resume.
import { stripHtml, norm, findSkills, containsTerm } from "./text.js";

const UA = { "User-Agent": "CareerCopilot/1.0 (personal job search tool)" };
const DAY = 86400000;

async function getJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 20000);
  try {
    const r = await fetch(url, { headers: { ...UA, ...(opts.headers || {}) }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("timed out");
    // undici hides the useful part ("ENOTFOUND", "proxy 403") in e.cause.
    const cause = e.cause?.code || e.cause?.message;
    throw cause && e.message === "fetch failed" ? new Error(`network error (${String(cause).slice(0, 80)})`) : e;
  } finally {
    clearTimeout(t);
  }
}

// Like Promise.allSettled for multi-page/multi-board fetches, but if every
// request failed, surface the error instead of pretending there were 0 jobs.
function settled(results) {
  const ok = results.filter((p) => p.status === "fulfilled");
  if (!ok.length && results.length) throw results[0].reason;
  return ok.map((p) => p.value);
}

function toDate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function job(o) {
  const description = stripHtml(o.description || "").slice(0, 12000);
  return {
    id: `${o.source}:${o.sourceId ?? o.url}`,
    source: o.source,
    title: (o.title || "").trim(),
    company: (o.company || "").trim(),
    location: o.location || "",
    remote: o.remote ?? /remote|anywhere|worldwide/i.test(`${o.location} ${o.title}`),
    rawType: o.rawType || "",
    salary: o.salary || "",
    postedAt: toDate(o.postedAt)?.toISOString() || null,
    expiresAt: toDate(o.expiresAt)?.toISOString() || null,
    url: o.url,
    applyUrl: o.applyUrl || o.url,
    description,
    tags: o.tags || [],
    seniority: o.seniority || "",
    via: o.via || "",
  };
}

// ---------- Free sources (no key) ----------

const sources = {
  async remotive(q) {
    const d = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q.query)}&limit=60`);
    return d.jobs.map((j) => job({ source: "Remotive", sourceId: j.id, title: j.title, company: j.company_name, location: j.candidate_required_location, remote: true, rawType: j.job_type, salary: j.salary, postedAt: j.publication_date, url: j.url, description: j.description, tags: j.tags }));
  },

  async remoteok(q) {
    const tag = norm(q.query).split(" ").slice(-1)[0] || "design";
    const d = await getJson(`https://remoteok.com/api?tag=${encodeURIComponent(tag)}`);
    return d.filter((j) => j.id).map((j) => job({ source: "RemoteOK", sourceId: j.id, title: j.position, company: j.company, location: j.location || "Remote", remote: true, salary: j.salary_min ? `$${j.salary_min.toLocaleString()}–$${j.salary_max.toLocaleString()}` : "", postedAt: j.date, url: j.url, applyUrl: j.apply_url, description: j.description, tags: j.tags }));
  },

  async himalayas(q) {
    const pages = await Promise.allSettled([1, 2].map((p) => getJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q.query)}&page=${p}`)));
    return settled(pages).flatMap((v) => v.jobs || []).map((j) => job({ source: "Himalayas", sourceId: j.guid, title: j.title, company: j.companyName, location: (j.locationRestrictions || []).join(", ") || "Remote", remote: true, rawType: j.employmentType, salary: j.minSalary ? `${j.currency || "$"}${j.minSalary}–${j.maxSalary} ${j.salaryPeriod || ""}` : "", postedAt: j.pubDate, expiresAt: j.expiryDate, url: j.guid, applyUrl: j.applicationLink, description: j.description, seniority: Array.isArray(j.seniority) ? j.seniority.join(", ") : j.seniority, tags: j.categories }));
  },

  async jobicy(q) {
    const tag = norm(q.query).split(" ")[0];
    const d = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`);
    return (d.jobs || []).map((j) => job({ source: "Jobicy", sourceId: j.id, title: j.jobTitle, company: j.companyName, location: j.jobGeo, remote: true, rawType: Array.isArray(j.jobType) ? j.jobType.join(", ") : j.jobType, salary: j.annualSalaryMin ? `${j.salaryCurrency || "$"}${j.annualSalaryMin}–${j.annualSalaryMax}` : "", postedAt: j.pubDate, url: j.url, description: j.jobDescription, seniority: j.jobLevel, tags: [].concat(j.jobIndustry || []) }));
  },

  async arbeitnow(q) {
    const pages = await Promise.allSettled([1, 2, 3].map((p) => getJson(`https://www.arbeitnow.com/api/job-board-api?page=${p}`)));
    return settled(pages).flatMap((v) => v.data || []).map((j) => job({ source: "Arbeitnow", sourceId: j.slug, title: j.title, company: j.company_name, location: j.location, remote: j.remote, rawType: (j.job_types || []).join(", "), postedAt: j.created_at, url: j.url, description: j.description, tags: j.tags }));
  },

  async themuse(q) {
    const cats = q.museCategories?.length ? q.museCategories : ["Design and UX", "Creative and Design", "Arts and Entertainment"];
    const qs = cats.map((c) => `category=${encodeURIComponent(c)}`).join("&");
    const pages = await Promise.allSettled([0, 1, 2].map((p) => getJson(`https://www.themuse.com/api/public/jobs?page=${p}&${qs}${q.location ? `&location=${encodeURIComponent(q.location)}` : ""}`)));
    return settled(pages).flatMap((v) => v.results || []).map((j) => job({ source: "The Muse", sourceId: j.id, title: j.name, company: j.company?.name, location: (j.locations || []).map((l) => l.name).join("; "), postedAt: j.publication_date, url: j.refs?.landing_page, description: j.contents, seniority: (j.levels || []).map((l) => l.name).join(", "), tags: (j.categories || []).map((c) => c.name) }));
  },

  async greenhouse(q, s) {
    const all = await Promise.allSettled((s.greenhouseBoards || []).map(async (b) => {
      const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b)}/jobs?content=true`);
      return (d.jobs || []).map((j) => job({ source: "Greenhouse", via: b, sourceId: j.id, title: j.title, company: j.company_name || b, location: j.location?.name, postedAt: j.first_published || j.updated_at, expiresAt: j.application_deadline, url: j.absolute_url, description: j.content }));
    }));
    return settled(all).flat();
  },

  async lever(q, s) {
    const all = await Promise.allSettled((s.leverBoards || []).map(async (b) => {
      const d = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(b)}?mode=json`);
      return d.map((j) => job({ source: "Lever", via: b, sourceId: j.id, title: j.text, company: b, location: j.categories?.allLocations || j.categories?.location, remote: /remote/i.test(j.workplaceType || ""), rawType: j.categories?.commitment, postedAt: j.createdAt, url: j.hostedUrl, applyUrl: j.applyUrl, description: `${j.descriptionPlain || ""}\n${(j.lists || []).map((l) => `${l.text}\n${stripHtml(l.content)}`).join("\n")}\n${j.additionalPlain || ""}` }));
    }));
    return settled(all).flat();
  },

  async ashby(q, s) {
    const all = await Promise.allSettled((s.ashbyBoards || []).map(async (b) => {
      const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b)}?includeCompensation=true`);
      return (d.jobs || []).filter((j) => j.isListed !== false).map((j) => job({ source: "Ashby", via: b, sourceId: j.id, title: j.title, company: b, location: j.location, remote: j.isRemote, rawType: j.employmentType, salary: j.compensation?.compensationTierSummary || "", postedAt: j.publishedAt, url: j.jobUrl, applyUrl: j.applyUrl, description: j.descriptionPlain }));
    }));
    return settled(all).flat();
  },

  // ---------- Keyed sources ----------

  async adzuna(q, s) {
    if (!s.adzunaAppId || !s.adzunaAppKey) throw new Error("needs Adzuna key");
    const u = new URL(`https://api.adzuna.com/v1/api/jobs/${s.adzunaCountry || "us"}/search/1`);
    u.searchParams.set("app_id", s.adzunaAppId);
    u.searchParams.set("app_key", s.adzunaAppKey);
    u.searchParams.set("results_per_page", "50");
    u.searchParams.set("what", q.query);
    u.searchParams.set("max_days_old", String(q.maxAgeDays || 30));
    if (q.location) u.searchParams.set("where", q.location);
    const d = await getJson(u);
    return (d.results || []).map((j) => job({ source: "Adzuna", sourceId: j.id, title: j.title, company: j.company?.display_name, location: j.location?.display_name, rawType: [j.contract_type, j.contract_time].filter(Boolean).join(", "), salary: j.salary_min ? `$${Math.round(j.salary_min).toLocaleString()}–$${Math.round(j.salary_max).toLocaleString()}${j.salary_is_predicted === "1" ? " (estimated)" : ""}` : "", postedAt: j.created, url: j.redirect_url, description: j.description }));
  },

  // JSearch aggregates Google for Jobs: LinkedIn, Indeed, Glassdoor, ZipRecruiter, company sites.
  async jsearch(q, s) {
    if (!s.rapidApiKey) throw new Error("needs RapidAPI key");
    const query = q.location ? `${q.query} in ${q.location}` : q.query;
    const age = (q.maxAgeDays || 30) <= 3 ? "3days" : (q.maxAgeDays || 30) <= 7 ? "week" : "month";
    const d = await getJson(`https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&num_pages=2&date_posted=${age}${q.remoteOnly ? "&work_from_home=true" : ""}`, { headers: { "x-rapidapi-key": s.rapidApiKey, "x-rapidapi-host": "jsearch.p.rapidapi.com" } });
    return (d.data || []).map((j) => job({ source: "JSearch", via: j.job_publisher, sourceId: j.job_id, title: j.job_title, company: j.employer_name, location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", "), remote: j.job_is_remote, rawType: j.job_employment_type, salary: j.job_min_salary ? `$${j.job_min_salary}–$${j.job_max_salary} ${j.job_salary_period || ""}` : "", postedAt: j.job_posted_at_datetime_utc, expiresAt: j.job_offer_expiration_datetime_utc, url: j.job_apply_link, description: j.job_description }));
  },

  async usajobs(q, s) {
    if (!s.usajobsKey || !s.usajobsEmail) throw new Error("needs USAJOBS key");
    const d = await getJson(`https://data.usajobs.gov/api/search?Keyword=${encodeURIComponent(q.query)}&ResultsPerPage=50${q.location ? `&LocationName=${encodeURIComponent(q.location)}` : ""}`, { headers: { "Authorization-Key": s.usajobsKey, "User-Agent": s.usajobsEmail, Host: "data.usajobs.gov" } });
    return (d.SearchResult?.SearchResultItems || []).map(({ MatchedObjectDescriptor: j }) => job({ source: "USAJOBS", sourceId: j.PositionID, title: j.PositionTitle, company: j.OrganizationName, location: j.PositionLocationDisplay, rawType: (j.PositionSchedule || []).map((x) => x.Name).join(", "), salary: j.PositionRemuneration?.[0] ? `$${j.PositionRemuneration[0].MinimumRange}–$${j.PositionRemuneration[0].MaximumRange}` : "", postedAt: j.PublicationStartDate, expiresAt: j.ApplicationCloseDate, url: j.PositionURI, description: j.UserArea?.Details?.JobSummary || j.QualificationSummary }));
  },
};

export const SOURCE_INFO = [
  { id: "remotive", name: "Remotive", keyed: false, note: "Remote jobs, good creative coverage" },
  { id: "himalayas", name: "Himalayas", keyed: false, note: "Remote jobs with expiry dates and seniority" },
  { id: "jobicy", name: "Jobicy", keyed: false, note: "Remote jobs, tagged contract/full-time" },
  { id: "remoteok", name: "RemoteOK", keyed: false, note: "Remote jobs, tag search" },
  { id: "themuse", name: "The Muse", keyed: false, note: "Design/creative categories, on-site + remote" },
  { id: "arbeitnow", name: "Arbeitnow", keyed: false, note: "Europe-heavy, many visa-sponsoring roles" },
  { id: "greenhouse", name: "Company boards (Greenhouse)", keyed: false, note: "Direct from companies you list in Settings" },
  { id: "lever", name: "Company boards (Lever)", keyed: false, note: "Direct from companies you list in Settings" },
  { id: "ashby", name: "Company boards (Ashby)", keyed: false, note: "Direct from companies you list in Settings" },
  { id: "adzuna", name: "Adzuna", keyed: true, note: "Huge aggregator, free key at developer.adzuna.com" },
  { id: "jsearch", name: "JSearch (LinkedIn, Indeed, Glassdoor…)", keyed: true, note: "Google for Jobs via RapidAPI; free tier" },
  { id: "usajobs", name: "USAJOBS", keyed: true, note: "US federal jobs; free key" },
  { id: "web", name: "AI web search", keyed: true, note: "Claude searches studio sites, Motionographer, ProductionHUB, LinkedIn etc. Uses API credits." },
];

// ---------- Classification and flags ----------

export function classifyType(j) {
  const t = `${j.rawType} ${j.title} ${j.description.slice(0, 3000)}`.toLowerCase();
  const raw = (j.rawType || "").toLowerCase();
  const has = (re) => re.test(t);
  if (/intern/.test(raw) || /\bintern(ship)?\b/i.test(j.title)) return "Internship";
  if (/freelance/.test(raw) || has(/\bfreelance(r)?\b|per[- ]project|project[- ]based|gig\b/)) return "Freelance";
  if (/contract|contractor|temporary|temp\b/.test(raw) || has(/\b(contract role|contract position|contract-to-hire|contract to hire|1099|c2c|corp[- ]to[- ]corp|w2 contract|\(contract\)|fixed[- ]term|temporary|\d+[- ]month contract)\b/)) {
    if (has(/contract[- ]to[- ]hire|temp[- ]to[- ]perm/)) return "Contract-to-hire";
    return "Contract";
  }
  if (/part/.test(raw) || has(/\bpart[- ]time\b/)) return "Part-time";
  if (/full/.test(raw) || has(/\bfull[- ]time\b|\bpermanent\b|\bfte\b/)) return "Full-time";
  return "Unspecified";
}

export function flagsFor(j) {
  const t = `${j.company} ${j.description}`.toLowerCase();
  const flags = [];
  if (/\b(staffing|recruit(ing|ers?)|talent solutions|consulting group|workforce)\b/.test(j.company.toLowerCase()) || /\bour client\b|on behalf of (our|a) client/.test(t))
    flags.push({ level: "info", text: "Posted by a staffing agency or recruiter. Ask who the end client is and whether it's W2 or 1099." });
  if (/telegram|whatsapp|signal app|google hangouts|check (will be|to) (deposit|cash)|purchase (your own )?equipment|pay(ment)? (a|the) fee|training fee|crypto(currency)? payment/.test(t))
    flags.push({ level: "danger", text: "Contains common job-scam language (chat-app interviews, equipment checks, fees). Verify independently before sharing personal info." });
  if (/unpaid|for exposure|portfolio piece|spec work|test project.*(unpaid|free)/.test(t))
    flags.push({ level: "warn", text: "Mentions unpaid work, spec work or an unpaid test. Ask for paid tests or a reasonable scope." });
  if (!j.salary && !/\$\s?\d|salary range|compensation/.test(t))
    flags.push({ level: "info", text: "No pay listed. Check local pay-transparency laws; many US states require a range." });
  if (/1099/.test(t)) flags.push({ level: "info", text: "1099 = independent contractor: no benefits, you pay self-employment tax (~15.3% US). Price your rate accordingly." });
  return flags;
}

function relevance(j, profile) {
  const titleN = norm(j.title);
  const text = norm(`${j.title} ${j.description}`);
  const targets = (profile.targetRoles || []).map(norm).filter(Boolean);
  const keywords = (profile.keywords || []).filter(Boolean);
  const mySkills = profile.skills || [];
  let score = 0;
  const why = [];

  const titleHit = targets.find((r) => titleN.includes(r) || r.split(" ").filter((w) => w.length > 3).every((w) => titleN.includes(w)));
  if (titleHit) { score += 45; why.push(`title matches "${titleHit}"`); }
  else if (targets.some((r) => r.split(" ").some((w) => w.length > 4 && titleN.includes(w)))) { score += 20; why.push("title partly matches"); }

  const kwHits = keywords.filter((k) => containsTerm(text, k));
  score += Math.min(25, kwHits.length * 6);
  if (kwHits.length) why.push(`mentions ${kwHits.slice(0, 4).join(", ")}`);

  const jobSkills = findSkills(j.description);
  const overlap = jobSkills.filter((s) => mySkills.includes(s));
  if (jobSkills.length) {
    score += Math.round(30 * (overlap.length / jobSkills.length));
    if (overlap.length) why.push(`${overlap.length}/${jobSkills.length} listed tools/skills you have`);
  }
  const avoid = (profile.avoidKeywords || []).filter((k) => k && containsTerm(text, k));
  if (avoid.length) { score -= 30; why.push(`contains avoided: ${avoid.join(", ")}`); }
  return { score: Math.max(0, Math.min(100, score)), why, jobSkills, missingSkills: jobSkills.filter((s) => !mySkills.includes(s)) };
}

function matchesQuery(j, queries) {
  const text = norm(`${j.title} ${j.tags.join(" ")} ${j.description.slice(0, 2500)}`);
  const title = norm(j.title);
  return queries.some((q) => {
    const words = norm(q).split(" ").filter((w) => w.length > 2);
    if (!words.length) return true;
    return words.every((w) => text.includes(w)) && words.some((w) => title.includes(w.replace(/s$/, "")));
  });
}

/**
 * @param {object} q {queries[], location, remoteOnly, maxAgeDays, sources[], types[]}
 * @param {object} s settings
 * @param {object} profile {targetRoles, keywords, skills, avoidKeywords}
 */
export async function searchJobs(q, s, profile) {
  const chosen = (q.sources?.length ? q.sources : SOURCE_INFO.filter((x) => !x.keyed).map((x) => x.id)).filter((id) => sources[id]);
  const queries = (q.queries || []).map((x) => x.trim()).filter(Boolean);
  if (!queries.length) queries.push("motion designer");
  const status = {};
  const results = [];

  await Promise.all(chosen.map(async (id) => {
    // Board-wide sources (company boards, arbeitnow, muse) are fetched once and filtered locally.
    const perQuery = !["greenhouse", "lever", "ashby", "arbeitnow", "themuse"].includes(id);
    const qs = perQuery ? queries : [queries[0]];
    try {
      const batches = await Promise.all(qs.map((query) => sources[id]({ ...q, query }, s)));
      const got = batches.flat();
      results.push(...got);
      status[id] = { ok: true, count: got.length };
    } catch (e) {
      status[id] = { ok: false, error: String(e.message || e) };
    }
  }));

  const now = Date.now();
  const maxAge = (q.maxAgeDays || 30) * DAY;
  const seen = new Map();
  let stale = 0, expired = 0, offTopic = 0;
  for (const j of results) {
    if (!j.title || !j.url) continue;
    if (j.expiresAt && new Date(j.expiresAt).getTime() < now) { expired++; continue; }
    if (j.postedAt && now - new Date(j.postedAt).getTime() > maxAge) { stale++; continue; }
    if (!matchesQuery(j, queries)) { offTopic++; continue; }
    if (q.remoteOnly && !j.remote) continue;
    if (q.location && !q.remoteOnly && !j.remote && !norm(j.location).includes(norm(q.location).split(" ")[0])) continue;
    const key = `${norm(j.title)}|${norm(j.company)}`;
    const prev = seen.get(key);
    if (prev) { prev.alsoOn = [...new Set([...(prev.alsoOn || []), j.source])]; continue; }
    j.type = classifyType(j);
    j.flags = flagsFor(j);
    j.fit = relevance(j, profile);
    seen.set(key, j);
  }
  let jobs = [...seen.values()];
  if (q.types?.length) jobs = jobs.filter((j) => q.types.includes(j.type));
  jobs.sort((a, b) => b.fit.score - a.fit.score || new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
  return { jobs: jobs.slice(0, 300), status, dropped: { stale, expired, offTopic }, total: results.length };
}

// ---------- Is this posting still open? ----------

const CLOSED_PATTERNS = [
  /no longer (accepting|available|open|active)/i, /(position|job|role|posting) (has been|is) (filled|closed|expired|removed)/i,
  /this job (has )?expired/i, /job (is )?not found/i, /posting (has )?closed/i, /applications? (are|is) (now )?closed/i,
  /the job you are looking for is no longer open/i, /we couldn.t find (that|this) job/i, /this position is no longer/i,
];

export async function verifyPosting(url) {
  if (!/^https?:\/\//i.test(url || "")) return { status: "unknown", reason: "No URL" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { ...UA, Accept: "text/html" }, redirect: "follow", signal: ctrl.signal });
    if ([404, 410].includes(r.status)) return { status: "closed", reason: `Page returns ${r.status}` };
    if (r.status === 999 || r.status === 403 || r.status === 429) return { status: "unknown", reason: `Site blocks automated checks (${r.status}). Open it to confirm.` };
    if (!r.ok) return { status: "unknown", reason: `HTTP ${r.status}` };
    const body = (await r.text()).slice(0, 400000);
    const hit = CLOSED_PATTERNS.find((p) => p.test(body));
    if (hit) return { status: "closed", reason: `Page says: "${body.match(hit)[0]}"` };
    // Redirect to a generic careers page usually means the posting was taken down.
    const finalUrl = r.url || url;
    if (finalUrl !== url && /\/(careers|jobs)\/?(\?.*)?$/i.test(finalUrl)) return { status: "likely-closed", reason: "Redirects to the general careers page" };
    return { status: "open", reason: "Page loads and shows no closed notice", checkedAt: new Date().toISOString() };
  } catch (e) {
    const cause = e.cause?.code || e.cause?.message;
    return { status: "unknown", reason: e.name === "AbortError" ? "Timed out" : cause ? `Couldn't load the page (${String(cause).slice(0, 80)})` : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}
