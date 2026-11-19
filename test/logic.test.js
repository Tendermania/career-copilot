// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { findEvidence, titleEvidence, stem, findSkills } from "../lib/text.js";
import { analyze } from "../lib/ats.js";
import { relevance } from "../lib/jobs.js";
import { auditGaps, evaluateWithEvidence } from "../lib/evaluate.js";
import { parseConnections, companyKey, buildContext, scoreConnection, leadQuality, overview } from "../lib/network.js";

const RESUME = `Jordan Example
jordan@example.com | jordan.example.com

SKILLS
Social Media Marketing, Video Editing, After Effects, Canva

EXPERIENCE
Marketing Coordinator | Acme | Jan 2022 – Present
- Managed Instagram and TikTok accounts, growing followers 40%
- Ran paid campaigns across
Meta and Google

EDUCATION
BA Communications, State University, 2021`;

const JOB = { title: "Social Media Marketing Manager", description: "We need a social media marketing manager with social media marketing experience. You will run paid social campaigns, manage content calendars and report on analytics. Experience with Hootsuite and Python is a plus. Social media marketing strategy across Instagram and TikTok." };

test("stemmer makes word forms comparable", () => {
  assert.equal(stem("marketing"), stem("marketer"));
  assert.equal(stem("managed"), stem("management"));
  assert.equal(stem("animation"), stem("animator"));
});

test("evidence: exact, reworded, wrapped lines and true negatives", () => {
  assert.equal(findEvidence(RESUME, "social media marketing").match, "exact");
  assert.equal(findEvidence(RESUME, "Social media marketer").match, "close");
  assert.ok(findEvidence(RESUME, "3+ years of social media marketing experience"));
  assert.ok(findEvidence(RESUME, "campaigns on Meta"), "phrase split across two lines");
  assert.equal(findEvidence(RESUME, "Python"), null);
  assert.equal(findEvidence(RESUME, "Cinema 4D"), null);
});

test("job title evidence", () => {
  assert.equal(titleEvidence(RESUME, "Marketing Coordinator (Remote)").level, "full");
  assert.equal(titleEvidence(RESUME, "Senior Social Media Marketing Manager").level, "partial");
  assert.equal(titleEvidence(RESUME, "Motion Designer").level, null);
});

test("skills vocabulary knows social media marketing", () => {
  assert.ok(findSkills(RESUME).includes("Social media marketing"));
});

test("ATS check doesn't list social media marketing as missing", () => {
  const k = analyze({ resumeText: RESUME, jobText: JOB.description, jobTitle: JOB.title }).keyword;
  assert.ok(k.matched.includes("Social media marketing"));
  assert.ok(!k.missing.some((m) => /social media marketing$/i.test(m)));
  assert.ok(k.missing.includes("Python"));
});

test("job fit credits the resume even when the focus is another field", () => {
  const motionFocus = { targetRoles: ["Motion Designer"], keywords: ["After Effects"], skills: findSkills(RESUME), resumeText: RESUME };
  const fit = relevance({ title: JOB.title, description: JOB.description }, motionFocus);
  assert.ok(fit.score >= 40, `score ${fit.score}`);
  assert.ok(!fit.missingSkills.includes("Social media marketing"));
  const none = relevance({ title: JOB.title, description: JOB.description }, { ...motionFocus, skills: [], resumeText: "Line cook, 2019-2024" });
  assert.ok(none.score < fit.score);
});

test("audit catches a 'missing' gap the resume covers, and re-asks once", async () => {
  const bad = { gaps: [{ requirement: "Social media marketing experience", status: "missing", severity: "dealbreaker", suggestion: "" }, { requirement: "Python", status: "missing", severity: "minor", suggestion: "" }] };
  const wrong = auditGaps(bad, RESUME);
  assert.equal(wrong.length, 1);
  assert.match(wrong[0].quote, /Social Media Marketing/);

  const calls = [];
  const run = async (input) => {
    calls.push(input);
    return { data: input.corrections?.length ? { gaps: [{ requirement: "Python", status: "missing", severity: "minor", suggestion: "" }] } : structuredClone(bad) };
  };
  const out = await evaluateWithEvidence(run, { resume: { text: RESUME }, job: JOB });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].coverage.some((c) => /social media marketing/i.test(c.term)));
  assert.equal(calls[1].corrections[0].requirement, "Social media marketing experience");
  assert.deepEqual(out.evidence.rechecked, 1);
  assert.equal(out.evidence.disputed, 0);
});

test("audit flags what the AI still gets wrong after the retry", async () => {
  const run = async () => ({ data: { gaps: [{ requirement: "Social media marketing experience", status: "missing", severity: "major", suggestion: "", resumeEvidence: "" }] } });
  const out = await evaluateWithEvidence(run, { resume: { text: RESUME }, job: JOB });
  assert.equal(out.data.gaps[0].disputed, true);
  assert.match(out.data.gaps[0].resumeEvidence, /Social Media Marketing/);
});

const CSV = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Sam,Lee,https://www.linkedin.com/in/samlee,,"Duolingo, Inc.",Motion Design Lead,14 Nov 2025
Ana,Diaz,https://www.linkedin.com/in/ana,,Acme,Senior Recruiter,01 Jan 2020
Bo,Chen,https://www.linkedin.com/in/bo,,Globex,Accountant,02 Feb 2021
Sam,Lee,https://www.linkedin.com/in/samlee,,"Duolingo, Inc.",Motion Design Lead,14 Nov 2025
`;

test("LinkedIn export parses past the notes preamble, with quotes and duplicates", () => {
  const { items, skipped } = parseConnections(CSV);
  assert.equal(items.length, 3);
  assert.equal(skipped, 1);
  assert.equal(items[0].company, "Duolingo, Inc.");
  assert.equal(items[0].connectedOn, "2025-11-14");
  assert.throws(() => parseConnections("just,some\nrandom,csv"), /LinkedIn connections file/);
});

test("company names normalise", () => {
  assert.equal(companyKey("Duolingo, Inc."), companyKey("duolingo"));
  assert.equal(companyKey("The Acme Company LLC"), "acme");
});

const tracker = [{ id: "t1", company: "Duolingo", role: "Motion Designer", status: "applied" }];
const focus = { roles: ["Motion Designer"], keywords: ["After Effects"] };

test("connections rank by company, field and role", () => {
  const ctx = buildContext({ focus, tracker, targets: ["Acme"] });
  const [sam, ana, bo] = parseConnections(CSV).items.map((c) => scoreConnection(c, ctx));
  assert.equal(sam.tier, "strong");
  assert.equal(sam.roleType, "hiring manager");
  assert.ok(ana.tags.includes("recruiter") && ana.score > bo.score);
  assert.equal(bo.score, 0);
});

test("lead quality responds to relationship, company, status and rating", () => {
  const ctx = buildContext({ focus, tracker });
  const base = { name: "Sam Lee", title: "Motion Design Lead", company: "Duolingo", relationship: "Former colleague", status: "talking" };
  const warm = leadQuality(base, ctx);
  const cold = leadQuality({ ...base, relationship: "Cold (no link yet)", status: "new", company: "Globex" }, ctx);
  assert.equal(warm.tier, "High");
  assert.ok(cold.score < warm.score);
  assert.ok(leadQuality({ ...base, rating: "not" }, ctx).score <= 15);
  assert.match(warm.nextStep, /applied for Motion Designer/);
});

test("overview ties leads, connections and companies together", () => {
  const ov = overview({ focus, tracker, savedJobs: [], connections: parseConnections(CSV).items, leadsStore: { items: [{ id: "l1", name: "Sam Lee", company: "Duolingo Inc", title: "Motion Design Lead", relationship: "LinkedIn connection", status: "new" }], targets: ["Acme"] } });
  assert.equal(ov.suggestions.find((c) => c.name === "Sam Lee").isLead, true, "matched by name + company without a URL");
  const duo = ov.companies.find((c) => c.key === "duolingo");
  assert.equal(duo.leads.length, 1);
  assert.equal(duo.connectionCount, 0);
  assert.equal(ov.companies.find((c) => c.key === "acme").connectionCount, 1);
});

test("posting filler is not offered as keywords", async () => {
  const { topPhrases } = await import("../lib/text.js");
  const job = "We want a motion designer. Please note this is a freelance role. Please send your reel. You will meet the team. Our best work is motion design for brand campaigns. Brand campaigns and motion design are the core of what we do. Hook viewers fast. Please apply.";
  const got = topPhrases(job);
  for (const junk of ["want", "please", "please note", "note", "meet", "best", "hook", "you.", "you. please"]) assert.ok(!got.includes(junk), `${junk} should be filtered`);
  assert.ok(got.includes("brand campaigns"));
  assert.ok(got.some((p) => p.includes("motion design")));
});
