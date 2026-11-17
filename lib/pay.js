// Pay: what kind it is (salaried, hourly, day rate, per project…) and the amount the posting states.
// Amounts only ever come from the posting itself (the board's pay field or the description text);
// when a posting gives no figure we still say what kind of pay it most likely is, marked as a guess.

const SYM = { "$": "USD", "£": "GBP", "€": "EUR", "₹": "INR", "¥": "JPY" };
const CODE_SYM = { USD: "$", GBP: "£", EUR: "€", INR: "₹", JPY: "¥", CAD: "CA$", AUD: "A$", NZD: "NZ$", CHF: "CHF ", SGD: "S$", SEK: "SEK ", NOK: "NOK ", DKK: "DKK ", PLN: "PLN ", BRL: "R$", MXN: "MX$", ZAR: "R" };
const CODES = "USD|CAD|AUD|NZD|GBP|EUR|CHF|SGD|INR|SEK|NOK|DKK|PLN|BRL|MXN|ZAR|JPY";

export const PAY_KINDS = {
  salary: { label: "Salaried", unit: "/yr" },
  hourly: { label: "Hourly", unit: "/hr" },
  daily: { label: "Day rate", unit: "/day" },
  weekly: { label: "Weekly pay", unit: "/wk" },
  monthly: { label: "Monthly pay", unit: "/mo" },
  project: { label: "Per project", unit: " per project" },
  unknown: { label: "Pay type not stated", unit: "" },
};
const YEARLY = { salary: 1, hourly: 2080, daily: 260, weekly: 52, monthly: 12 };

function periodKind(p = "") {
  const t = String(p).toLowerCase().trim();
  if (!t) return "";
  if (/^(h|hr|hrs|hour|hours|hourly)\b|per hour|an hour|\/ ?h/.test(t)) return "hourly";
  if (/^(d|day|days|daily)\b|per day|day rate/.test(t)) return "daily";
  if (/^(w|wk|week|weeks|weekly)\b|per week/.test(t)) return "weekly";
  if (/^(m|mo|mon|month|months|monthly)\b|per month/.test(t)) return "monthly";
  if (/^(y|yr|yrs|year|years|yearly|annum|annual|annually|pa)\b|per year|per annum|p\.a\./.test(t)) return "salary";
  if (/project|fixed|flat|gig|video|deliverable|piece|milestone/.test(t)) return "project";
  return "";
}

function num(s, k) {
  let n = parseFloat(String(s).replace(/,/g, "").replace(/^(\d{1,3})\.(\d{3})$/, "$1$2"));
  if (!isFinite(n)) return null;
  if (k) n *= 1000;
  return n;
}

// A bare figure with no period: decide by size. Deliberately conservative in the grey zones.
function kindBySize(n) {
  if (n >= 15000) return "salary";
  if (n >= 8 && n <= 350) return "hourly";
  return "";
}

const AMOUNT = new RegExp(
  `(?:(${CODES})\\s?)?([$£€₹¥])?\\s?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s?(k\\b)?(?:\\s?(${CODES})\\b)?` +
  `(?:\\s?(?:-|–|—|to|and)\\s?(?:(?:${CODES})\\s?)?[$£€₹¥]?\\s?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s?(k\\b)?(?:\\s?(${CODES})\\b)?)?` +
  `(?:\\s?(?:\\/|per|an?|each|p\\.?)\\s?(hours?|hr|h|days?|weeks?|wk|months?|mo|years?|yr|annum|a\\b|project|video|gig|piece)\\b|\\s?(hourly|daily|weekly|monthly|annually|annual|yearly|pa)\\b)?`,
  "gi"
);
const NEAR_PAY = /salary|compensation|\bpay\b|pay range|base|\brate\b|budget|wage|earn|\bote\b|stipend|remuneration|per hour|hourly|annual/i;
const NOT_PAY = /funding|raised|series [a-e]\b|valuation|revenue|\barr\b|customers|users|downloads|followers|subscribers|employees|bonus|sign[- ]on|equity|stipend for|budget for (?:learning|equipment|home office)|allowance|reimburse|401|\bgift\b|million|billion|\bmm?\b|in sales|views|impressions/i;

/** Every believable pay figure in a block of text, best first. */
function findAmounts(text, { needCurrency = true } = {}) {
  const out = [];
  const t = String(text || "");
  for (const m of t.matchAll(AMOUNT)) {
    const [raw, code1, sym, a, ak, code2, b, bk, code3, per1, per2] = m;
    const currency = code1 || code2 || code3 || (sym ? SYM[sym] : "");
    if (needCurrency && !currency) continue;
    const after = t.slice(m.index + raw.length, m.index + raw.length + 14);
    if (/^\s?(m|mm|bn|b|million|billion)\b/i.test(after)) continue; // $5M funding, not pay
    if (/^\s?%/.test(after)) continue;
    const kBoth = ak || bk; // "$90-120k"
    let min = num(a, ak || (b && bk)), max = b ? num(b, bk || (kBoth && ak)) : null;
    if (min == null) continue;
    if (max != null && max < min) { if (ak && !bk && max * 1000 >= min) max *= 1000; else max = null; }
    if (max != null && max > min * 6) max = null; // unrelated second number
    const around = t.slice(Math.max(0, m.index - 90), m.index + raw.length + 60);
    const before = t.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
    const next = t.slice(m.index + raw.length, m.index + raw.length + 28).toLowerCase(); // just past the figure, same clause
    const top = max || min;
    const sane = (k) => k && !((k === "salary" && (top < 8000 || top > 2000000)) || (k === "hourly" && (top < 5 || top > 600)) || (k === "daily" && (top < 40 || top > 6000)) || (k === "weekly" && (top < 100 || top > 30000)) || (k === "monthly" && (top < 300 || top > 120000)));
    let kind = periodKind(per1 === "a" ? "year" : per1 || per2 || "");
    if (!kind) {
      const w = `${before.slice(-45)} | ${next.split(/[.;\n]| or | and /)[0]}`;
      const ctx = /per project|fixed (?:price|fee|budget)|flat (?:fee|rate)|per video|per piece|budget (?:is|of|:)/.test(w) ? "project" : /hourly|per hour|\/ ?hr/.test(w) ? "hourly" : /day rate|per day/.test(w) ? "daily" : /per month|monthly/.test(w) ? "monthly" : /annual|per year|salary|base pay|\bote\b/.test(w) ? "salary" : "";
      kind = sane(ctx) ? ctx : kindBySize(top);
    }
    if (!sane(kind)) continue;
    const notPay = NOT_PAY.test(before.slice(-32)) || /^\s?(?:in |of )?(?:funding|bonus|sign[- ]on|revenue|customers|users|employees|followers|views|stipend|allowance)/.test(next);
    let weight = 1 + (NEAR_PAY.test(around) ? 3 : 0) + (max ? 1.5 : 0) + (per1 || per2 ? 1.5 : 0) + (currency ? 0.5 : 0) - (notPay ? 4 : 0);
    if (weight <= 0) continue;
    out.push({ kind, min, max: max || null, currency: currency || "USD", weight, raw: raw.trim() });
  }
  return out.sort((x, y) => y.weight - x.weight);
}

const fmtNum = (n, kind) => (kind === "salary" && n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? Math.round(n).toLocaleString("en-US") : String(+n.toFixed(2)));
export function formatAmount(p) {
  if (!p || p.min == null) return "";
  const s = CODE_SYM[p.currency] ?? `${p.currency} `;
  const range = p.max && p.max !== p.min ? `${s}${fmtNum(p.min, p.kind)}–${s}${fmtNum(p.max, p.kind)}` : `${s}${fmtNum(p.min, p.kind)}`;
  return `${range}${PAY_KINDS[p.kind]?.unit || ""}`;
}

/**
 * @param {object} j job: {salary, payHint:{min,max,currency,period}, rawType, type, title, description}
 * @returns {{kind, label, min, max, currency, text, from, estimated, annualMin, annualMax, annualText, note}}
 *   from: "listing" (the board's pay field), "description" (found in the posting text) or "none".
 *   estimated: true when the kind is a guess (no figure or period given) or the board itself predicted the pay.
 */
export function parsePay(j) {
  const h = j.payHint || {};
  let hit = null, from = "none";
  if (h.min) {
    const kind = periodKind(h.period) || kindBySize(Number(h.max || h.min));
    if (kind) { hit = { kind, min: Number(h.min), max: Number(h.max) > Number(h.min) ? Number(h.max) : null, currency: (SYM[h.currency] || String(h.currency || "USD").toUpperCase()).slice(0, 3) }; from = "listing"; }
  }
  if (!hit && j.salary) { const a = findAmounts(j.salary, { needCurrency: false })[0]; if (a) { hit = a; from = "listing"; } }
  if (!hit) { const a = findAmounts(`${j.title || ""}\n${j.description || ""}`)[0]; if (a && a.weight >= 2.5) { hit = a; from = "description"; } }

  if (hit) {
    const mult = YEARLY[hit.kind];
    const out = { kind: hit.kind, label: PAY_KINDS[hit.kind].label, min: hit.min, max: hit.max, currency: hit.currency, from, estimated: !!h.predicted, text: "", annualMin: mult ? Math.round(hit.min * mult) : null, annualMax: mult && hit.max ? Math.round(hit.max * mult) : null, annualText: "", note: "" };
    out.text = formatAmount(out);
    if (mult && hit.kind !== "salary") out.annualText = `about ${formatAmount({ kind: "salary", min: out.annualMin, max: out.annualMax, currency: hit.currency })} full-time`;
    out.note = h.predicted ? "The job board estimated this figure; the employer did not list it." : from === "listing" ? "From the pay field on the listing." : "Found in the posting's description.";
    return out;
  }

  // No figure anywhere: say what kind it most likely is, and that it's a guess.
  const text = `${j.rawType || ""} ${j.title || ""} ${String(j.description || "").slice(0, 5000)}`.toLowerCase();
  const type = j.type || "";
  let kind = "unknown", why = "";
  if (/hourly rate|per hour|paid hourly|hourly (?:pay|wage|position|role)|\bw-?2 hourly\b|\/ ?hr\b/.test(text)) { kind = "hourly"; why = "the posting mentions hourly pay"; }
  else if (/day rate|per day|daily rate/.test(text)) { kind = "daily"; why = "the posting mentions a day rate"; }
  else if (/per project|project[- ]based|fixed (?:price|fee|budget)|flat (?:fee|rate)|per video|per piece/.test(text)) { kind = "project"; why = "the posting describes project-based pay"; }
  else if (/annual salary|base salary|salary range|salaried|competitive salary|\bsalary\b/.test(text)) { kind = "salary"; why = "the posting mentions a salary"; }
  else if (type === "Full-time") { kind = "salary"; why = "full-time roles are normally salaried"; }
  else if (type === "Freelance") { kind = "project"; why = "freelance work is usually paid per project or by the hour"; }
  else if (["Contract", "Contract-to-hire", "Part-time", "Internship"].includes(type)) { kind = "hourly"; why = `${type.toLowerCase()} roles are usually paid hourly`; }
  return { kind, label: PAY_KINDS[kind].label, min: null, max: null, currency: "", from: "none", estimated: kind !== "unknown", text: "", annualMin: null, annualMax: null, annualText: "", note: kind === "unknown" ? "The posting doesn't say how the role is paid." : `No amount listed. Likely ${PAY_KINDS[kind].label.toLowerCase()}: ${why}.` };
}

/** "$85k or $60/hr" → {salary: 85000, hourly: 60}. Used to compare a job's pay with the minimum in Preferences. */
export function parseMinPay(text) {
  const out = {};
  for (const a of findAmounts(String(text || ""), { needCurrency: false })) if (out[a.kind] == null) out[a.kind] = a.min;
  if (out.salary == null && out.hourly != null) out.salaryFromHourly = out.hourly * 2080;
  if (out.hourly == null && out.salary != null) out.hourlyFromSalary = out.salary / 2080;
  return out;
}
