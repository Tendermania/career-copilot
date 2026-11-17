// Job search across many boards. Each adapter returns normalized jobs; the
// aggregator dedupes, drops stale/expired postings, classifies job type,
// flags risks, and ranks by fit to the active profile/resume.
import { stripHtml, norm } from "./text.js";
import { parsePay } from "./pay.js";
import { scoreFit } from "./fit.js";

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
    payHint: o.payHint || null,
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
    return d.filter((j) => j.id).map((j) => job({ source: "RemoteOK", sourceId: j.id, title: j.position, company: j.company, location: j.location || "Remote", remote: true, salary: j.salary_min ? `$${j.salary_min.toLocaleString()}–$${j.salary_max.toLocaleString()}` : "", payHint: j.salary_min ? { min: j.salary_min, max: j.salary_max, currency: "USD", period: "year" } : null, postedAt: j.date, url: j.url, applyUrl: j.apply_url, description: j.description, tags: j.tags }));
  },

  async himalayas(q) {
    const pages = await Promise.allSettled([1, 2].map((p) => getJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q.query)}&page=${p}`)));
    return settled(pages).flatMap((v) => v.jobs || []).map((j) => job({ source: "Himalayas", sourceId: j.guid, title: j.title, company: j.companyName, location: (j.locationRestrictions || []).join(", ") || "Remote", remote: true, rawType: j.employmentType, salary: j.minSalary ? `${j.currency || "$"}${j.minSalary}–${j.maxSalary} ${j.salaryPeriod || ""}` : "", payHint: j.minSalary ? { min: j.minSalary, max: j.maxSalary, currency: j.currency || "USD", period: j.salaryPeriod || "" } : null, postedAt: j.pubDate, expiresAt: j.expiryDate, url: j.guid, applyUrl: j.applicationLink, description: j.description, seniority: Array.isArray(j.seniority) ? j.seniority.join(", ") : j.seniority, tags: j.categories }));
  },

  async jobicy(q) {
    const tag = norm(q.query).split(" ")[0];
    const d = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`);
    return (d.jobs || []).map((j) => job({ source: "Jobicy", sourceId: j.id, title: j.jobTitle, company: j.companyName, location: j.jobGeo, remote: true, rawType: Array.isArray(j.jobType) ? j.jobType.join(", ") : j.jobType, salary: j.annualSalaryMin ? `${j.salaryCurrency || "$"}${j.annualSalaryMin}–${j.annualSalaryMax}` : "", payHint: j.annualSalaryMin ? { min: Number(j.annualSalaryMin), max: Number(j.annualSalaryMax), currency: j.salaryCurrency || "USD", period: "year" } : null, postedAt: j.pubDate, url: j.url, description: j.jobDescription, seniority: j.jobLevel, tags: [].concat(j.jobIndustry || []) }));
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
    return (d.results || []).map((j) => job({ source: "Adzuna", sourceId: j.id, title: j.title, company: j.company?.display_name, location: j.location?.display_name, rawType: [j.contract_type, j.contract_time].filter(Boolean).join(", "), salary: j.salary_min ? `$${Math.round(j.salary_min).toLocaleString()}–$${Math.round(j.salary_max).toLocaleString()}${j.salary_is_predicted === "1" ? " (estimated)" : ""}` : "", payHint: j.salary_min ? { min: j.salary_min, max: j.salary_max, currency: { gb: "GBP", ca: "CAD", au: "AUD", de: "EUR", fr: "EUR", nl: "EUR", in: "INR" }[s.adzunaCountry] || "USD", period: "year", predicted: j.salary_is_predicted === "1" } : null, postedAt: j.created, url: j.redirect_url, description: j.description }));
  },

  // JSearch aggregates Google for Jobs: LinkedIn, Indeed, Glassdoor, ZipRecruiter, company sites.
  async jsearch(q, s) {
    if (!s.rapidApiKey) throw new Error("needs RapidAPI key");
    const query = q.location ? `${q.query} in ${q.location}` : q.query;
    const age = (q.maxAgeDays || 30) <= 3 ? "3days" : (q.maxAgeDays || 30) <= 7 ? "week" : "month";
    const d = await getJson(`https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&num_pages=2&date_posted=${age}${q.remoteOnly ? "&work_from_home=true" : ""}`, { headers: { "x-rapidapi-key": s.rapidApiKey, "x-rapidapi-host": "jsearch.p.rapidapi.com" } });
    return (d.data || []).map((j) => job({ source: "JSearch", via: j.job_publisher, sourceId: j.job_id, title: j.job_title, company: j.employer_name, location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", "), remote: j.job_is_remote, rawType: j.job_employment_type, salary: j.job_min_salary ? `$${j.job_min_salary}–$${j.job_max_salary} ${j.job_salary_period || ""}` : "", payHint: j.job_min_salary ? { min: j.job_min_salary, max: j.job_max_salary, currency: j.job_salary_currency || "USD", period: j.job_salary_period || "" } : null, postedAt: j.job_posted_at_datetime_utc, expiresAt: j.job_offer_expiration_datetime_utc, url: j.job_apply_link, description: j.job_description }));
  },

  async usajobs(q, s) {
    if (!s.usajobsKey || !s.usajobsEmail) throw new Error("needs USAJOBS key");
    const d = await getJson(`https://data.usajobs.gov/api/search?Keyword=${encodeURIComponent(q.query)}&ResultsPerPage=50${q.location ? `&LocationName=${encodeURIComponent(q.location)}` : ""}`, { headers: { "Authorization-Key": s.usajobsKey, "User-Agent": s.usajobsEmail, Host: "data.usajobs.gov" } });
    return (d.SearchResult?.SearchResultItems || []).map(({ MatchedObjectDescriptor: j }) => job({ source: "USAJOBS", sourceId: j.PositionID, title: j.PositionTitle, company: j.OrganizationName, location: j.PositionLocationDisplay, rawType: (j.PositionSchedule || []).map((x) => x.Name).join(", "), salary: j.PositionRemuneration?.[0] ? `$${j.PositionRemuneration[0].MinimumRange}–$${j.PositionRemuneration[0].MaximumRange}` : "", payHint: j.PositionRemuneration?.[0] ? { min: Number(j.PositionRemuneration[0].MinimumRange), max: Number(j.PositionRemuneration[0].MaximumRange), currency: "USD", period: /hour|PH/i.test(j.PositionRemuneration[0].RateIntervalCode || j.PositionRemuneration[0].Description || "") ? "hour" : "year" } : null, postedAt: j.PublicationStartDate, expiresAt: j.ApplicationCloseDate, url: j.PositionURI, description: j.UserArea?.Details?.JobSummary || j.QualificationSummary }));
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
  if (/contract|contractor|temporary|temp\b/.test(raw) || has(/\b(contract role|contract position|contract-to-hire|contract to hire|1099|c2c|corp[- ]to[- ]corp|w2 contract|\(contract\)|fixed[- ]term|temporary|short[- ]term|seasonal|per diem|day rate|\d+[- ]month contract|\d+[- ]week (contract|project|engagement))\b/)) {
    if (has(/contract[- ]to[- ]hire|temp[- ]to[- ]perm/)) return "Contract-to-hire";
    return "Contract";
  }
  if (/part/.test(raw) || has(/\bpart[- ]time\b/)) return "Part-time";
  if (/full/.test(raw) || has(/\bfull[- ]time\b|\bpermanent\b|\bfte\b/)) return "Full-time";
  return "Unspecified";
}


// ---------- Where is the job? (pay rates differ a lot between the US and abroad) ----------

const US_STATES = "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia";
const US_ABBR = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US_CITIES = "New York City|NYC|Los Angeles|San Francisco|San Diego|San Jose|Seattle|Portland|Chicago|Austin|Boston|Atlanta|Denver|Miami|Dallas|Houston|Brooklyn|Santa Monica|Burbank|Culver City|Pasadena|Philadelphia|Phoenix|Nashville|Minneapolis|Las Vegas|Salt Lake City";
const RE_US = new RegExp(`\\b(?:united states|usa|u\\.s\\.a?\\.?|us only|us-based|us based|(?:remote|anywhere)[ ,(/-]+(?:in )?(?:the )?us)\\b|^\\s*us\\s*$|(?:^|[,;(/\\-–] ?)(?:${US_STATES})\\b|\\b(?:${US_CITIES})\\b`, "i");
const RE_US_ABBR_CASE = new RegExp(`,\\s*(?:${US_ABBR})(?:\\s+\\d{5})?\\s*(?:$|[,;(])`);
const ABROAD = "United Kingdom|UK|U\\.K\\.|England|Scotland|Wales|Ireland|Germany|France|Spain|Italy|Portugal|Netherlands|Belgium|Switzerland|Austria|Sweden|Norway|Denmark|Finland|Poland|Czech(?:ia| Republic)?|Romania|Ukraine|Greece|Turkey|Estonia|Lithuania|Latvia|Hungary|Serbia|Bulgaria|Croatia|Canada|Mexico|Brazil|Argentina|Colombia|Chile|Peru|Costa Rica|India|Pakistan|Bangladesh|Philippines|Indonesia|Vietnam|Thailand|Malaysia|Singapore|Japan|South Korea|Korea|China|Hong Kong|Taiwan|Australia|New Zealand|Israel|UAE|United Arab Emirates|Saudi Arabia|Egypt|Nigeria|Kenya|South Africa|Europe|European Union|EU|EMEA|APAC|LATAM|Latin America|Asia|Africa|Middle East|London|Berlin|Paris|Amsterdam|Dublin|Barcelona|Madrid|Lisbon|Munich|Zurich|Stockholm|Copenhagen|Oslo|Helsinki|Warsaw|Prague|Toronto|Vancouver|Montreal|Calgary|Sydney|Melbourne|Bangalore|Bengaluru|Mumbai|Delhi|Dubai|Tel Aviv|Manchester|Edinburgh|Brussels|Vienna|Milan|Rome|Bucharest|Kyiv|Mexico City|Sao Paulo|São Paulo|Buenos Aires|Tokyo|Seoul|Manila|Jakarta|Cape Town|Lagos|Nairobi";
const RE_ABROAD = new RegExp(`\\b(?:${ABROAD})\\b`, "i");
const RE_GLOBAL = /\b(worldwide|world[- ]wide|anywhere|global(ly)?|any ?where in the world|work from anywhere)\b/i;
const CURRENCY = [[/£|\bgbp\b/i, "GBP"], [/€|\beur\b/i, "EUR"], [/\bcad\b|c\$|ca\$/i, "CAD"], [/\baud\b|a\$|au\$/i, "AUD"], [/₹|\binr\b/i, "INR"], [/\bchf\b/i, "CHF"], [/\bsek\b|\bnok\b|\bdkk\b/i, "Nordic currency"], [/\bpln\b|zł/i, "PLN"], [/\bbrl\b|r\$/i, "BRL"], [/\bmxn\b/i, "MXN"]];

/**
 * Classify where a posting is based. Returns {id: "us"|"abroad"|"mixed"|"global"|"unknown", label, note}.
 * "global" = remote and open to anywhere (rates are negotiated, often in USD).
 */
export function regionOf(j) {
  const loc = String(j.location || "");
  const src = j.source || "";
  const salary = String(j.salary || "");
  const cur = CURRENCY.find(([re]) => re.test(salary));
  const US = RE_US.test(loc) || RE_US_ABBR_CASE.test(loc) || src === "USAJOBS";
  const AB = RE_ABROAD.test(loc);
  const abroadCur = cur ? cur[1] : "";
  let id = "unknown";
  if (US && AB) id = "mixed";
  else if (US) id = "us";
  else if (AB) id = "abroad";
  else if (RE_GLOBAL.test(loc)) id = "global";
  else if (abroadCur) id = "abroad";
  // Location text empty or just "Remote": read the description for hard requirements.
  if (id === "unknown" || (id === "global" && !/worldwide|anywhere/i.test(loc))) {
    const d = String(j.description || "").slice(0, 4000);
    if (/\b(must|need to|required to) (be|live|reside|work)[^.]{0,40}\b(in the (us|u\.s\.|united states)|us[- ]based)\b|\bus (residents?|citizens?) only\b|\b(authorized|eligible|legally authorized) to work in the (us|u\.s\.|united states)\b|\bunited states only\b|\bus[- ]based\b/i.test(d)) id = "us";
    else if (/\b(must|need to|required to) (be|live|reside|work)[^.]{0,40}\b(in|within) (the )?(uk|europe|eu|canada|australia|india|emea)\b|\beu (work )?(permit|authori[sz]ation)\b|\b(right|permit) to work in the (uk|eu|canada)\b/i.test(d)) id = "abroad";
    else if (id === "unknown" && j.remote && /worldwide|anywhere in the world|work from anywhere/i.test(d)) id = "global";
  }
  const label = { us: "US", abroad: "Abroad", mixed: "US + abroad", global: "Remote, anywhere", unknown: "Location unclear" }[id];
  const note = {
    us: "US-based: US market rates; contractors typically bill in USD.",
    abroad: `Outside the US: pay is usually local-market${abroadCur ? ` (${abroadCur})` : ""} and often lower than US rates. Confirm currency, who pays you, and any tax or contractor-status rules.`,
    mixed: "Listed in both the US and other countries. Ask which location's pay scale applies.",
    global: "Remote and open to anywhere: ask whether pay is set by US rates or by where you live.",
    unknown: "Couldn't tell where this role is based. Ask before negotiating rates.",
  }[id];
  return { id, label, note, currency: abroadCur || (id === "us" ? "USD" : "") };
}

// ---------- Who posted it? Agencies and staffing firms are often the route to contract gigs ----------

const RE_STAFFING = /\b(staffing|recruit(?:ing|ers?|ment)|talent (?:solutions|partners|acquisition|agency)|talent|workforce|placement|search group|resources|aquent|creative circle|creative group|vitamin t|robert half|randstad|kforce|insight global|apex systems|teksystems|adecco|manpower|hays|mondo|24 seven|artisan creative|onward search)\b/i;
const RE_AGENCY = /\b(agency|agencies|studios?|creative (?:co|company|collective|shop)|collective|productions?|motion (?:co|house|design)|design (?:co|group|studio|firm)|brand(?:ing)? (?:co|firm)|advertising|marketing group|media group|post[- ]production|animation)\b/i;

export function employerKind(j) {
  const c = String(j.company || "");
  const d = String(j.description || "").slice(0, 3000);
  if (RE_STAFFING.test(c) || /\bour client\b|on behalf of (our|a|an) (client|client's)|\bw2 (contract|hourly)\b|\bc2c\b|corp[- ]to[- ]corp|\bour (fortune|leading|well[- ]known) (500 )?client\b|\bclient is (a|an|seeking)\b/i.test(d)) return "staffing";
  if (RE_AGENCY.test(c) || /\b(we are|we're|as) an? ((creative|design|motion|branding|digital|advertising|full[- ]service|integrated) )?(agency|studio|production (company|house))\b|\b(our|the) (agency|studio)\b/i.test(d)) return "agency";
  return "direct";
}

// Extra queries so short-term and agency work shows up even when the posting never says "motion designer" the way you do.
const GIG_MODIFIERS = ["freelance", "contract"];
export function gigQueries(base) {
  const out = [...base];
  for (const b of base.slice(0, 3)) for (const m of GIG_MODIFIERS) if (!new RegExp(`\\b${m}\\b`, "i").test(b)) out.push(`${m} ${b}`);
  return [...new Set(out)].slice(0, 9);
}

export const AGENCY_DIRECTORY = [
  { name: "Aquent", kind: "staffing", note: "Creative and marketing staffing; lots of W2 contract gigs" },
  { name: "Creative Circle", kind: "staffing", note: "Creative staffing: contract, freelance and temp-to-perm" },
  { name: "The Creative Group (Robert Half)", kind: "staffing", note: "Creative and marketing contract placements" },
  { name: "Vitamin T", kind: "staffing", note: "Creative staffing, strong in motion and video" },
  { name: "Mondo", kind: "staffing", note: "Digital and creative staffing" },
  { name: "24 Seven Talent", kind: "staffing", note: "Creative, digital and marketing talent" },
  { name: "Artisan Creative", kind: "staffing", note: "Creative and digital recruiting, contract and perm" },
  { name: "Onward Search", kind: "staffing", note: "Creative, digital and marketing placements" },
  { name: "Motionographer / ProductionHUB", kind: "agency", note: "Studios and production companies post freelance calls" },
];

/** Fills in everything derived from a posting: type, where it is, who posted it, flags. */
export function annotate(j) {
  j.type = classifyType(j);
  j.region = regionOf(j);
  j.employerKind = employerKind(j);
  j.pay = parsePay(j);
  j.flags = flagsFor(j);
  return j;
}

export function flagsFor(j) {
  const t = `${j.company} ${j.description}`.toLowerCase();
  const flags = [];
  const kind = j.employerKind || employerKind(j);
  if (kind === "staffing")
    flags.push({ level: "info", text: "Posted by a staffing agency or recruiter. Good route to contract gigs: ask who the end client is, whether it's W2 or 1099, and the hourly rate." });
  else if (kind === "agency")
    flags.push({ level: "info", text: "Posted by an agency or studio. These often hire freelancers by the day or project: ask about rate, duration and whether it's W2 or 1099." });
  if (/telegram|whatsapp|signal app|google hangouts|check (will be|to) (deposit|cash)|purchase (your own )?equipment|pay(ment)? (a|the) fee|training fee|crypto(currency)? payment/.test(t))
    flags.push({ level: "danger", text: "Contains common job-scam language (chat-app interviews, equipment checks, fees). Verify independently before sharing personal info." });
  if (/unpaid|for exposure|portfolio piece|spec work|test project.*(unpaid|free)/.test(t))
    flags.push({ level: "warn", text: "Mentions unpaid work, spec work or an unpaid test. Ask for paid tests or a reasonable scope." });
  if (!(j.pay ? j.pay.min != null : j.salary) && !/\$\s?\d|salary range|compensation/.test(t))
    flags.push({ level: "info", text: "No pay listed. Check local pay-transparency laws; many US states require a range." });
  const reg = j.region || regionOf(j);
  if (reg.id === "abroad") flags.push({ level: "info", text: `Based outside the US. ${reg.note}` });
  if (/1099/.test(t)) flags.push({ level: "info", text: "1099 = independent contractor: no benefits, you pay self-employment tax (~15.3% US). Price your rate accordingly." });
  return flags;
}

/** Classify, price, flag and score one job. Used for every source, including AI web search and hidden posts. */
export function assess(j, profile) {
  annotate(j);
  j.fit = scoreFit(j, profile);
  return j;
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
  // Gig mode fetches extra "freelance …" / "contract …" variants; relevance is still judged against your own queries.
  const fetchQueries = q.gigs ? gigQueries(queries) : queries;
  const status = {};
  const results = [];

  await Promise.all(chosen.map(async (id) => {
    // Board-wide sources (company boards, arbeitnow, muse) are fetched once and filtered locally.
    const perQuery = !["greenhouse", "lever", "ashby", "arbeitnow", "themuse"].includes(id);
    const qs = perQuery ? fetchQueries : [queries[0]];
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
    assess(j, profile);
    seen.set(key, j);
  }
  let jobs = [...seen.values()];
  if (q.types?.length) jobs = jobs.filter((j) => q.types.includes(j.type));
  if (q.employers?.length) jobs = jobs.filter((j) => q.employers.includes(j.employerKind));
  if (q.regions?.length) jobs = jobs.filter((j) => q.regions.includes(j.region.id) || (j.region.id === "mixed" && q.regions.some((r) => r === "us" || r === "abroad")));
  jobs.sort((a, b) => b.fit.score - a.fit.score || new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
  jobs = jobs.slice(0, 300);
  // Boards keep listings up after the employer closes them, so open the best matches and drop any that are gone.
  let closed = 0, checked = 0;
  if (q.verify !== false) ({ jobs, closed, checked } = await pruneClosed(jobs, { limit: q.verifyLimit || 60 }));
  return { jobs, status, dropped: { stale, expired, offTopic, closed }, verified: checked, total: results.length };
}

// ---------- Is this posting still open? ----------

const CLOSED_PATTERNS = [
  /no longer (?:accepting|available|open|active|hiring|taking)/i, /(?:position|job|role|posting|vacancy|listing|opening|opportunity) (?:has been|is|was) (?:now )?(?:filled|closed|expired|removed|taken down|deleted|archived|unpublished)/i,
  /this job (?:has )?expired/i, /job (?:is )?not found/i, /posting (?:has )?closed/i, /applications? (?:are|is|have|has) (?:now |been )?closed/i,
  /the job you are looking for is no longer open/i, /we couldn.t find (?:that|this) (?:job|page|posting)/i, /this (?:position|job|role|listing|vacancy) is no longer/i,
  /(?:job|position|role|listing|page) (?:you.re|you are) looking for (?:doesn.t|does not|no longer) exist/i, /(?:has|have) been filled/i, /job (?:has been )?(?:removed|archived|deactivated)/i,
  /sorry,? (?:but )?(?:this|that|the) (?:job|position|role|posting|listing) (?:is|has)/i, /expired job/i, /this listing (?:has )?expired/i, /not accepting applications/i, /oops[^<]{0,40}(?:job|page) (?:was|is) not found/i,
];
// A posting that moved to a board's generic list or search page was taken down.
const GENERIC_PATH = /\/(?:careers?|jobs?|openings|positions|search|remote-jobs|job-search)\/?$/i;

function readStructured(html) {
  // schema.org JobPosting: validThrough is the employer's own closing date.
  const out = {};
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) return o.forEach(walk); if (/JobPosting/i.test(String(o["@type"]))) { out.found = true; if (o.validThrough) out.validThrough = o.validThrough; if (o.datePosted) out.datePosted = o.datePosted; } if (o["@graph"]) walk(o["@graph"]); };
      walk(JSON.parse(m[1].trim()));
    } catch { /* malformed JSON-LD is common */ }
  }
  return out;
}

async function checkOne(url, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; CareerCopilot/1.0; personal job search tool)", Accept: "text/html,application/xhtml+xml", "Accept-Language": "en" }, redirect: "follow", signal: ctrl.signal });
    if ([404, 410].includes(r.status)) return { status: "closed", reason: `Page returns ${r.status} (removed)` };
    if ([999, 401, 403, 429].includes(r.status)) return { status: "unknown", reason: `Site blocks automated checks (${r.status}). Open it to confirm.` };
    if (!r.ok) return { status: "unknown", reason: `HTTP ${r.status}` };
    const body = (await r.text()).slice(0, 600000);
    const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
    if (/\b(404|not found|page not found|no longer available|expired|job closed)\b/i.test(title)) return { status: "closed", reason: `Page title says “${title.trim().slice(0, 60)}”` };
    const visible = body.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
    const hit = CLOSED_PATTERNS.find((p) => p.test(visible));
    if (hit) return { status: "closed", reason: `Page says: “${visible.match(hit)[0].trim()}”` };
    const sd = readStructured(body);
    if (sd.validThrough && Date.parse(sd.validThrough) && Date.parse(sd.validThrough) < Date.now() - DAY) return { status: "closed", reason: `Employer's closing date passed (${new Date(sd.validThrough).toLocaleDateString()})` };
    const finalUrl = r.url || url;
    if (finalUrl !== url) {
      const a = new URL(url), b = new URL(finalUrl);
      if (GENERIC_PATH.test(b.pathname) && !GENERIC_PATH.test(a.pathname)) return { status: "likely-closed", reason: "Redirects to the general jobs page, so the posting was probably taken down" };
      if (b.pathname === "/" && a.pathname.length > 1) return { status: "likely-closed", reason: "Redirects to the site's home page, so the posting was probably taken down" };
    }
    return { status: "open", reason: sd.found ? "Live posting page with current job data" : "Page loads and shows no closed notice" };
  } catch (e) {
    const cause = e.cause?.code || e.cause?.message;
    return { status: "unknown", reason: e.name === "AbortError" ? "Timed out" : cause ? `Couldn't load the page (${String(cause).slice(0, 80)})` : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Check the listing page and, when the apply link goes somewhere else (the employer's own site),
 * that page too: aggregators often keep a listing up after the employer has closed it.
 */
export async function verifyPosting(url, applyUrl, { timeout = 15000 } = {}) {
  if (!/^https?:\/\//i.test(url || "")) return { status: "unknown", reason: "No URL" };
  const checkedAt = new Date().toISOString();
  const first = await checkOne(url, timeout);
  if (first.status === "closed" || first.status === "likely-closed") return { ...first, checkedAt };
  let other = null;
  try { if (applyUrl && /^https?:\/\//i.test(applyUrl) && new URL(applyUrl).host !== new URL(url).host) other = await checkOne(applyUrl, timeout); } catch { /* bad apply link */ }
  if (other && (other.status === "closed" || other.status === "likely-closed")) return { status: other.status, reason: `Apply page: ${other.reason}`, checkedAt };
  if (first.status === "open") return { ...first, checkedAt };
  if (other && other.status === "open") return { status: "open", reason: "The employer's apply page is live", checkedAt };
  return { ...first, checkedAt };
}

/** Verify the first `limit` jobs (a few at a time) and remove the ones that are closed. */
export async function pruneClosed(jobs, { limit = 60, concurrency = 8, timeout = 9000, budget = 25000 } = {}) {
  const head = jobs.slice(0, limit), t0 = Date.now();
  let i = 0, checked = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, head.length) }, async () => {
    while (i < head.length && Date.now() - t0 < budget) {
      const j = head[i++];
      j.verified = await verifyPosting(j.url, j.applyUrl, { timeout });
      checked++;
    }
  }));
  const gone = (j) => j.verified && (j.verified.status === "closed" || j.verified.status === "likely-closed");
  return { jobs: jobs.filter((j) => !gone(j)), closed: jobs.filter(gone).length, checked };
}
