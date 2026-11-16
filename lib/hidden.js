// Hidden opportunities: the postings that never reach a normal job board. People asking for help in
// Reddit threads, Hacker News "who is hiring" / freelancer threads, and Mastodon hashtags. Everything
// here is a public, keyless endpoint. Results are shaped like normal jobs so the existing cards,
// tracker, cover letter and outreach tools work on them unchanged.
import { annotate } from "./jobs.js";

const UA = "CareerCopilot/1.0 (local job-search tool)";
const MOCK = process.env.HIDDEN_MOCK || ""; // tests only
const DAY = 86400000;

async function getJson(url, ms = 20000) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const decode = (t) => String(t || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const text = (html) => decode(String(html || "").replace(/<\/(p|div|li)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*/g, "\n").trim();

// Subreddits worth watching, by career focus. Base list covers general hiring threads.
const BASE_SUBS = ["forhire", "DesignJobs", "hiring", "jobbit"];
const FOCUS_SUBS = {
  motion: ["MotionDesign", "AfterEffects"], social: ["socialmedia", "SocialMediaMarketing"], uxui: ["UXDesign", "userexperience"], graphic: ["graphic_design", "logodesign"],
  video: ["VideoEditing", "videography"], content: ["copywriting", "content_marketing"], marketing: ["digital_marketing", "PPC"], web: ["web_design", "webdev"], qa: ["QualityAssurance"], illustration: ["ArtCommissions"],
};
const FOCUS_TAGS = {
  motion: ["motiondesign", "motiongraphics", "animation"], social: ["socialmedia", "socialmediajobs", "communitymanager"], uxui: ["uxdesign", "uxjobs", "productdesign"], graphic: ["graphicdesign", "designjobs"],
  video: ["videoediting", "videography"], content: ["copywriting", "contentmarketing"], marketing: ["digitalmarketing", "growthmarketing"], web: ["webdesign", "frontend"], qa: ["qa", "softwaretesting"], illustration: ["illustration"],
};
const focusKey = (focus) => String(focus?.id || "").split("-")[0];

const INTENT = /\b(hiring|we(?:'| a)re hiring|looking for|seeking|wanted|need(?:ed)? (?:a|an|someone)|open(?:ing)? for|apply|freelancers? wanted|paid (?:gig|project)|contract(?: role)?|join (?:our|the) team)\b|\[h\]|\[hiring\]/i;
const OFFER = /\[for hire\]|\[fh\]|\bfor hire\b|\bavailable for (?:work|freelance|hire)\b|\bi(?:'| a)m (?:a |an )?(?:freelance|available)|my portfolio|hire me/i;
const BAD = /\bunpaid\b|\bfor exposure\b|\bfor free\b|\bequity only\b|\brev(?:enue)?[- ]share\b|\bno pay\b|\bvolunteer\b/i;
const PAY = /\$\s?\d[\d,.]*\s?(?:k\b)?(?:\s?[-–/]\s?\$?\s?\d[\d,.]*\s?k?)?(?:\s?(?:\/|per)\s?(?:hr|hour|h|day|week|month|year|yr|project|video))?|\b\d[\d,.]*\s?(?:usd|eur|gbp)\b/i;

function terms(queries, focus) {
  const set = new Set();
  for (const q of [...(queries || []), ...(focus?.roles || []), ...(focus?.keywords || [])]) for (const w of String(q).toLowerCase().split(/[^a-z0-9+#.]+/)) if (w.length > 2 && !["and", "the", "for", "with", "designer", "specialist", "manager", "junior", "senior"].includes(w)) set.add(w);
  return [...set];
}
function matchTerms(hay, wanted) { const h = hay.toLowerCase(); return wanted.filter((t) => h.includes(t)); }

/** Score an opportunity against the focus. */
function score({ title, body, date, remote }, wanted, focus) {
  const hay = `${title}\n${body}`; const hits = matchTerms(hay, wanted); const why = [];
  let s = 30;
  const roleHit = (focus?.roles || []).find((r) => hay.toLowerCase().includes(r.toLowerCase()));
  if (roleHit) { s += 22; why.push(`asks for a ${roleHit.toLowerCase()}`); }
  if (hits.length) { s += Math.min(24, hits.length * 6); why.push(`mentions ${hits.slice(0, 4).join(", ")}`); }
  if (INTENT.test(title)) { s += 6; }
  if (PAY.test(hay)) { s += 8; why.push(`pay mentioned: ${(hay.match(PAY) || [""])[0].trim().slice(0, 24)}`); }
  if (remote || /\bremote\b/i.test(hay)) { s += 3; why.push("remote-friendly"); }
  if (date && Date.now() - date < 3 * DAY) { s += 6; why.push("posted in the last 3 days"); } else if (date && Date.now() - date < 8 * DAY) s += 3;
  if (BAD.test(hay)) { s -= 28; why.push("may be unpaid or exposure-only"); }
  return { score: Math.max(5, Math.min(98, Math.round(s))), why, jobSkills: hits.slice(0, 8), missingSkills: [] };
}

function toJob({ source, via, id, title, author, body, url, date, extra = {} }, wanted, focus) {
  const description = String(body || "").slice(0, 4000);
  const j = {
    id: `Hidden:${source}:${id}`, source, via: via || "", title: String(title || "").replace(/\s+/g, " ").trim().slice(0, 140), company: author || "", location: extra.location || "Remote / unspecified",
    remote: true, rawType: "", salary: (`${title}\n${description}`.match(PAY) || [""])[0].trim().slice(0, 40), postedAt: date ? new Date(date).toISOString() : null, expiresAt: null,
    url, applyUrl: url, description, tags: [], seniority: "", hidden: true, ...extra,
  };
  annotate(j); j.fit = score({ title: j.title, body: description, date, remote: true }, wanted, focus);
  return j;
}

// ---------- Sources ----------
async function reddit(subs, wanted, days, focus) {
  const cutoff = days ? Date.now() - days * DAY : 0; const out = []; let ok = 0, failed = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      const url = MOCK ? `${MOCK}/reddit/${sub}` : `https://www.reddit.com/r/${sub}/new.json?limit=100&raw_json=1`;
      const j = await getJson(url); ok++;
      for (const c of j.data?.children || []) {
        const d = c.data; if (!d || d.stickied) continue;
        const t = `${d.title} ${d.link_flair_text || ""}`;
        if (!INTENT.test(t) || OFFER.test(t)) continue;
        const body = decode(d.selftext || ""); const date = (d.created_utc || 0) * 1000;
        if (cutoff && date < cutoff) continue;
        if (!matchTerms(`${d.title}\n${body}`, wanted).length) continue;
        out.push(toJob({ source: "Reddit", via: `r/${sub}`, id: d.id || d.permalink, title: d.title, author: `u/${d.author}`, body, url: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url, date }, wanted, focus));
      }
    } catch (e) { failed.push(`r/${sub}`); }
  }));
  return { jobs: out, ok: ok > 0, count: out.length, error: ok ? (failed.length ? `${failed.length} subreddit(s) unavailable: ${failed.slice(0, 3).join(", ")}` : "") : "Reddit didn't answer (it sometimes blocks automated requests from some networks)." };
}

async function hackerNews(wanted, days, focus) {
  const cutoff = days ? Date.now() - days * DAY : 0; const out = []; const base = MOCK ? `${MOCK}/hn` : "https://hn.algolia.com/api/v1/search_by_date";
  for (const q of ["Ask HN: Who is hiring", "Ask HN: Freelancer? Seeking freelancer"]) {
    const t = await getJson(`${base}?${new URLSearchParams({ query: q, tags: "story,author_whoishiring", hitsPerPage: "1" })}`); const id = t.hits?.[0]?.objectID; if (!id) continue;
    for (const k of wanted.slice(0, 4)) {
      const c = await getJson(`${base}?${new URLSearchParams({ tags: `comment,story_${id}`, query: k, hitsPerPage: "40" })}`);
      for (const h of c.hits || []) {
        const body = text(h.comment_text); const date = h.created_at ? new Date(h.created_at).getTime() : 0;
        if (!body || (cutoff && date < cutoff) || !matchTerms(body, wanted).length) continue;
        const head = body.split(/\n/)[0]; const company = /\s\|\s/.test(head.slice(0, 140)) ? head.split(/\s\|\s/)[0].replace(/^[^A-Za-z0-9]+/, "").slice(0, 60) : (head.match(/^([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s+(?:is|are|needs?|seeks?|hiring)/) || [])[1] || `HN: ${h.author}`;
        out.push(toJob({ source: "Hacker News", via: /Freelancer/i.test(q) ? "Seeking freelancer thread" : "Who is hiring thread", id: h.objectID, title: head.slice(0, 140), author: company, body, url: `https://news.ycombinator.com/item?id=${h.objectID}`, date }, wanted, focus));
      }
    }
  }
  const seen = new Set(); return { jobs: out.filter((j) => !seen.has(j.id) && seen.add(j.id)), ok: true, count: 0 };
}

async function mastodon(tags, wanted, days, focus) {
  const cutoff = days ? Date.now() - days * DAY : 0; const out = []; let ok = 0;
  await Promise.all(tags.map(async (tag) => {
    try {
      const url = MOCK ? `${MOCK}/mastodon/${tag}` : `https://mastodon.social/api/v1/timelines/tag/${tag}?limit=40`;
      const j = await getJson(url); ok++;
      for (const s of j) {
        const body = text(s.content); const date = s.created_at ? new Date(s.created_at).getTime() : 0;
        if ((cutoff && date < cutoff) || !INTENT.test(body) || OFFER.test(body) || !matchTerms(body, wanted).length) continue;
        out.push(toJob({ source: "Mastodon", via: `#${tag}`, id: s.id, title: body.split(/\n/)[0].slice(0, 140), author: `@${s.account?.acct || "?"}`, body, url: s.url, date }, wanted, focus));
      }
    } catch { /* one hashtag failing is fine */ }
  }));
  return { jobs: out, ok: ok > 0, count: out.length, error: ok ? "" : "Mastodon didn't answer." };
}

export const HIDDEN_SOURCES = [
  { id: "reddit", name: "Reddit", note: "Hiring posts in r/forhire, r/DesignJobs and subreddits for your field" },
  { id: "hn", name: "Hacker News", note: "Monthly “Who is hiring?” and “Seeking freelancer?” threads" },
  { id: "mastodon", name: "Mastodon", note: "Public #hiring and field hashtags" },
];

export async function searchHidden({ queries, days = 30, sources, focus }) {
  const want = new Set(sources?.length ? sources : HIDDEN_SOURCES.map((s) => s.id));
  const wanted = terms(queries, focus); const fk = focusKey(focus);
  const status = {}; let jobs = [];
  const run = async (id, fn) => { try { const r = await fn(); jobs.push(...r.jobs); status[id] = { ok: r.ok, count: r.jobs.length, error: r.error || "" }; } catch (e) { status[id] = { ok: false, count: 0, error: String(e.message || e) }; } };
  await Promise.all([
    want.has("reddit") && run("reddit", () => reddit([...new Set([...BASE_SUBS, ...(FOCUS_SUBS[fk] || [])])], wanted, days, focus)),
    want.has("hn") && run("hn", () => hackerNews(wanted, days, focus)),
    want.has("mastodon") && run("mastodon", () => mastodon([...new Set(["hiring", "jobs", "freelance", "fedihired", ...(FOCUS_TAGS[fk] || [])])], wanted, days, focus)),
  ].filter(Boolean));
  const seen = new Set(); jobs = jobs.filter((j) => !seen.has(j.url) && seen.add(j.url));
  jobs.sort((a, b) => b.fit.score - a.fit.score || new Date(b.postedAt || 0) - new Date(a.postedAt || 0));
  return { jobs: jobs.slice(0, 200), status, total: jobs.length, wanted };
}

/** Turn AI web-hunt findings into job cards. */
export function aiToJobs(list, wanted, focus) {
  return (list || []).filter((o) => o.url && o.title).map((o) => {
    const j = toJob({ source: "AI web hunt", via: o.source || "", id: o.url, title: o.title, author: o.company || "", body: `${o.why || ""}\n\nEvidence: ${o.evidence || o.url}`, url: o.url, date: o.posted ? Date.parse(o.posted) || null : null, extra: { location: o.location || "Remote / unspecified" } }, wanted, focus);
    j.fit.why.unshift(o.why || "found by web search"); j.fit.score = Math.max(j.fit.score, 55); return j;
  });
}
