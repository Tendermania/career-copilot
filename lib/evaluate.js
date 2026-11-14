// Wraps the AI fit evaluation in a plain text search of the resume, so the AI
// can't claim the person lacks something their resume states.
import { analyze } from "./ats.js";
import { findEvidence } from "./text.js";
import { resumeToText } from "./files.js";

function resumeTextOf(r) {
  if (!r) return "";
  if (typeof r === "string") return r;
  // Search both copies: the original text and the structured version can differ slightly.
  return [r.text, r.structured ? resumeToText(r.structured) : ""].filter(Boolean).join("\n");
}

function jobParts(job) {
  if (typeof job === "string") return { jobText: job, jobTitle: "" };
  return { jobText: `${job.title || ""}\n${job.description || job.text || ""}`, jobTitle: job.title || "" };
}

/** Gaps the AI called "missing" although a resume line backs them up. */
export function auditGaps(data, resumeText) {
  const out = [];
  for (const g of data?.gaps || []) {
    if (g.status !== "missing") continue;
    const ev = findEvidence(resumeText, g.requirement);
    if (ev) out.push({ requirement: g.requirement, status: g.status, quote: ev.quote, match: ev.match });
  }
  return out;
}

/**
 * Run the AI evaluation with a text search around it, so it can't claim the person
 * lacks something their resume states. Before: hand the AI the resume lines that
 * match the job's terms. After: if it still calls a covered requirement "missing",
 * show it the line and have it evaluate again (once).
 */
export async function evaluateWithEvidence(run, input) {
  const text = resumeTextOf(input.resume);
  const { jobText, jobTitle } = jobParts(input.job);
  const rep = analyze({ resumeText: text, jobText, jobTitle });
  const k = rep.keyword;
  const coverage = [];
  if (k?.titleEvidence?.level) coverage.push({ term: `Job title "${jobTitle}"${k.titleEvidence.level === "partial" ? ` (the "${k.titleEvidence.phrase}" part)` : ""}`, quote: k.titleEvidence.quote });
  for (const t of (k?.matched || []).slice(0, 30)) coverage.push({ term: t, quote: k.evidence[t].quote });
  const ats = k ? { termsFoundInResume: k.matched.length, exactWordingNotFound: k.missing.slice(0, 15), yearsAskedFor: k.requiredYears, yearsOnResume: k.estimatedYears } : {};

  let result = await run({ ...input, ats, coverage });
  let wrong = auditGaps(result.data, text);
  let rechecked = 0;
  if (wrong.length) {
    try {
      const second = await run({ ...input, ats, coverage, corrections: wrong, previous: result.data });
      rechecked = wrong.length;
      result = second;
      wrong = auditGaps(result.data, text);
    } catch {
      // Keep the first answer; the leftover contradictions are flagged below.
    }
  }
  // Anything still marked missing with a matching resume line gets the line attached, so the person can judge.
  for (const w of wrong) {
    const g = result.data.gaps.find((x) => x.requirement === w.requirement);
    if (g) { g.resumeEvidence ||= w.quote; g.disputed = true; }
  }
  result.evidence = { found: coverage.length, rechecked, disputed: wrong.length };
  return result;
}
