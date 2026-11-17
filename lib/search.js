// Web search for AI providers that have no built-in search (DeepSeek, Gemini, OpenAI-compatible,
// local models). The app runs the searches itself, then hands the results to whichever model you
// picked to read and summarise. Claude doesn't need this: it searches on Anthropic's side.
import { stripHtml } from "./text.js";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; CareerCopilot/1.0; personal job search tool)" };

export const SEARCH_PROVIDERS = {
  duckduckgo: { label: "DuckDuckGo (no key, best effort)", keyed: false, note: "Free and needs no account. It can be rate limited or blocked now and then; if so, add a Brave or Tavily key." },
  brave: { label: "Brave Search API", keyed: true, keyField: "braveApiKey", help: "https://brave.com/search/api/", note: "Reliable. Has a free monthly allowance; check Brave's current plans." },
  tavily: { label: "Tavily", keyed: true, keyField: "tavilyApiKey", help: "https://tavily.com", note: "Built for AI use. Has a free monthly allowance; check Tavily's current plans." },
};

export function searchStatus(s) {
  const id = SEARCH_PROVIDERS[s.searchProvider] ? s.searchProvider : "duckduckgo";
  const p = SEARCH_PROVIDERS[id];
  return { provider: id, label: p.label, ready: !p.keyed || !!s[p.keyField], keyed: p.keyed };
}

async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("timed out");
    const cause = e.cause?.code || e.cause?.message;
    throw cause && e.message === "fetch failed" ? new Error(`network error (${String(cause).slice(0, 60)})`) : e;
  } finally {
    clearTimeout(t);
  }
}

const adapters = {
  async brave(q, n, s) {
    const r = await get(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}`, { headers: { Accept: "application/json", "X-Subscription-Token": s.braveApiKey } });
    const d = await r.json();
    return (d.web?.results || []).map((x) => ({ title: x.title, url: x.url, snippet: stripHtml(x.description || "") }));
  },
  async tavily(q, n, s) {
    const r = await get("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.tavilyApiKey}` }, body: JSON.stringify({ query: q, max_results: n, search_depth: "basic" }) });
    const d = await r.json();
    return (d.results || []).map((x) => ({ title: x.title, url: x.url, snippet: String(x.content || "").slice(0, 400) }));
  },
  async duckduckgo(q, n) {
    const r = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
    const html = await r.text();
    const out = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
    for (const m of html.matchAll(re)) {
      let url = m[1].replace(/&amp;/g, "&");
      const wrapped = url.match(/[?&]uddg=([^&]+)/);
      if (wrapped) url = decodeURIComponent(wrapped[1]);
      else if (url.startsWith("//")) url = `https:${url}`;
      if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
      out.push({ title: stripHtml(m[2]), url, snippet: stripHtml(m[3] || "") });
      if (out.length >= n) break;
    }
    if (!out.length && /anomaly|captcha|unusual traffic|blocked/i.test(html)) throw new Error("DuckDuckGo is asking for a human check (rate limited)");
    return out;
  },
};

/**
 * Run several searches and merge the results. Throws only if every search failed.
 * @returns {{results: {title, url, snippet}[], errors: string[]}}
 */
export async function searchWeb(queries, s, { perQuery = 6, max = 40 } = {}) {
  const st = searchStatus(s);
  if (!st.ready) throw new Error(`Add a ${SEARCH_PROVIDERS[st.provider].label} key in Settings to search the web.`);
  const list = [...new Set(queries.map((q) => String(q).trim()).filter(Boolean))].slice(0, 10);
  const results = [], errors = [];
  const seen = new Set();
  // A few at a time: gentle on free tiers and on DuckDuckGo.
  for (let i = 0; i < list.length; i += 3) {
    const part = await Promise.allSettled(list.slice(i, i + 3).map((q) => adapters[st.provider](q, perQuery, s)));
    for (const p of part) {
      if (p.status === "rejected") { errors.push(String(p.reason?.message || p.reason)); continue; }
      for (const r of p.value) if (r.url && !seen.has(r.url)) { seen.add(r.url); results.push(r); }
    }
  }
  if (!results.length && errors.length) throw new Error(`Web search failed (${errors[0]}).`);
  return { results: results.slice(0, max), errors };
}

/** Search results as text a model can read. */
export function resultsToText(results) {
  return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
}
