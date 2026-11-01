// Claude-powered features. Every task returns validated JSON via structured
// outputs; web-backed tasks (company research, web job search) use the
// server-side web search tool and are parsed leniently.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { settings } from "./store.js";

let cached = { key: "", client: null };
function client() {
  const s = settings();
  if (!s.anthropicApiKey) {
    const e = new Error("No Anthropic API key yet. Add one in Settings (console.anthropic.com → API keys).");
    e.status = 400;
    throw e;
  }
  if (cached.key !== s.anthropicApiKey) cached = { key: s.anthropicApiKey, client: new Anthropic({ apiKey: s.anthropicApiKey }) };
  return cached.client;
}

const HONESTY = `Honesty rules (never break these):
- Never invent employers, job titles, dates, degrees, clients, awards, tools or metrics the person hasn't given.
- You may rephrase, reorder, merge, trim, and choose emphasis. You may surface skills clearly implied by their described work.
- Where a number would help but none was given, write a bracketed placeholder like [# videos/month] so the person fills in the truth.
- If the job needs something they don't have, say so plainly instead of papering over it.`;

const VOICE = `Write like a specific, thoughtful human, not a template: plain words, concrete details, varied sentence length.
Avoid stock phrases ("I am writing to express", "passionate about", "leverage", "delve", "fast-paced", "results-driven", "proven track record", "thrilled", "testament"), avoid em-dash chains, and avoid empty superlatives.`;

function profileBlock(profile = {}) {
  const p = profile || {};
  const focus = (p.focuses || []).find((f) => f.id === p.activeFocusId) || (p.focuses || [])[0] || {};
  const lines = [
    `Name: ${p.name || "(not given)"}`,
    p.headline && `Headline: ${p.headline}`,
    p.location && `Location: ${p.location}`,
    p.links?.length && `Links: ${p.links.join(", ")}`,
    `Current job focus: ${focus.label || "Motion graphics / motion design"}`,
    focus.roles?.length && `Target roles: ${focus.roles.join(", ")}`,
    focus.keywords?.length && `Focus keywords: ${focus.keywords.join(", ")}`,
    focus.industries?.length && `Industries of interest: ${focus.industries.join(", ")}`,
    focus.seniority && `Seniority: ${focus.seniority}`,
    p.whoIAm && `Who I am (in their words): ${p.whoIAm}`,
    p.whatIDo && `What I do / my craft: ${p.whatIDo}`,
    p.proudestWork && `Work I'm proudest of: ${p.proudestWork}`,
    p.values && `What matters to me in a job: ${p.values}`,
    p.workStyle && `How I like to work: ${p.workStyle}`,
    p.story && `Career story / context (gaps, pivots, why this field): ${p.story}`,
    p.goals && `Goals: ${p.goals}`,
    p.dealBreakers && `Deal-breakers: ${p.dealBreakers}`,
    p.preferences && `Preferences: ${JSON.stringify(p.preferences)}`,
    p.voiceSamples && `Samples of how I write (match this voice):\n${p.voiceSamples}`,
  ].filter(Boolean);
  return `ABOUT THE PERSON\n${lines.join("\n")}`;
}

async function create(params) {
  const s = settings();
  const c = client();
  const base = { model: s.model, ...params };
  // Server-side fallbacks re-run a declined request on another model automatically.
  if (s.useFallbacks) {
    try {
      return await c.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message))) throw e;
    }
  }
  return c.beta.messages.create(base);
}

function textOf(msg) {
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

function checkStop(msg) {
  if (msg.stop_reason === "refusal") {
    const e = new Error(`Claude declined this request${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : "."}`);
    e.status = 422;
    throw e;
  }
  if (msg.stop_reason === "max_tokens") {
    const e = new Error("The answer was too long and got cut off. Try a shorter input.");
    e.status = 422;
    throw e;
  }
}

async function structured({ system, user, schema, effort = "medium", maxTokens = 16000 }) {
  const format = zodOutputFormat(schema);
  const msg = await create({
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort, format: { type: format.type, schema: format.schema } },
  });
  checkStop(msg);
  return { data: format.parse(textOf(msg)), usage: msg.usage, model: msg.model };
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

async function withWebSearch({ system, user, schema, maxUses = 8, effort = "medium" }) {
  const messages = [{ role: "user", content: user }];
  let msg;
  for (let i = 0; i < 5; i++) {
    msg = await create({
      max_tokens: 16000,
      system,
      messages,
      output_config: { effort },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses }],
    });
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  checkStop(msg);
  const sources = [];
  for (const b of msg.content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) sources.push({ title: r.title, url: r.url });
  }
  let data;
  try {
    const parsed = extractJson(textOf(msg));
    const ok = schema.safeParse(parsed);
    data = ok.success ? ok.data : parsed;
  } catch {
    data = { raw: textOf(msg) };
  }
  return { data, sources: dedupeBy(sources, "url").slice(0, 25), usage: msg.usage, model: msg.model };
}

function dedupeBy(arr, k) {
  const seen = new Set();
  return arr.filter((x) => (seen.has(x[k]) ? false : seen.add(x[k])));
}

// ---------- Schemas ----------

const Item = z.object({
  title: z.string().describe("Role, degree, project name, or skill category"),
  organization: z.string().describe("Company, client, school; empty if none"),
  location: z.string(),
  dates: z.string().describe("Exactly as written, e.g. 'Jan 2023 – Present'"),
  bullets: z.array(z.string()),
  details: z.string().describe("Any non-bullet text for this item"),
});
const Section = z.object({
  heading: z.string().describe("Heading exactly as written"),
  kind: z.enum(["summary", "experience", "education", "skills", "projects", "awards", "certifications", "clients", "other"]),
  items: z.array(Item),
  text: z.string().describe("Free text for sections without items, e.g. a summary paragraph"),
});
export const ResumeSchema = z.object({
  contact: z.object({ name: z.string(), headline: z.string(), email: z.string(), phone: z.string(), location: z.string(), links: z.array(z.string()) }),
  sections: z.array(Section),
  format: z.object({
    bulletChar: z.string().describe("Bullet glyph used, e.g. • or -"),
    dateStyle: z.string().describe("e.g. 'Mon YYYY – Mon YYYY'"),
    headingCase: z.enum(["UPPERCASE", "Title Case", "Sentence case"]),
    itemLayout: z.string().describe("How each experience item is laid out, e.g. 'Title | Company | Location | Dates'"),
    approxPages: z.number(),
  }),
});

const JobSchema = z.object({
  title: z.string(), company: z.string(), location: z.string(),
  employmentType: z.enum(["Full-time", "Part-time", "Contract", "Contract-to-hire", "Freelance", "Internship", "Temporary", "Unspecified"]),
  workplace: z.enum(["Remote", "Hybrid", "On-site", "Unspecified"]),
  seniority: z.string(), salary: z.string(),
  mustHave: z.array(z.string()), niceToHave: z.array(z.string()),
  keywords: z.array(z.string()).describe("Exact terms an ATS or recruiter would search for, as written in the posting"),
  tools: z.array(z.string()), responsibilities: z.array(z.string()),
  summary: z.string(), redFlags: z.array(z.string()), greenFlags: z.array(z.string()),
});

const EvalSchema = z.object({
  fitScore: z.number().describe("0-100 honest fit"),
  verdict: z.enum(["Strong fit", "Good fit", "Stretch", "Long shot", "Not a fit"]),
  recommendation: z.enum(["Apply now", "Tailor first, then apply", "Apply + get a referral", "Stretch: apply only with a strong reel", "Skip"]),
  headline: z.string().describe("One-sentence bottom line"),
  recruiterSixSeconds: z.string().describe("What a recruiter skimming for 6 seconds would take away"),
  strengths: z.array(z.object({ point: z.string(), evidence: z.string() })),
  gaps: z.array(z.object({ requirement: z.string(), severity: z.enum(["dealbreaker", "major", "minor"]), status: z.enum(["you have it but it's not on the resume", "partially", "missing"]), suggestion: z.string() })),
  sectionFeedback: z.array(z.object({ section: z.string(), feedback: z.string() })),
  portfolioAdvice: z.string().describe("Which reel/portfolio pieces to lead with for this job, and what's missing"),
  questionsForYou: z.array(z.string()).describe("Questions only the person can answer that would strengthen the application (real metrics, unlisted experience)"),
});

const TailorSchema = z.object({
  resume: ResumeSchema,
  summaryOfChanges: z.string(),
  changes: z.array(z.object({ where: z.string(), before: z.string(), after: z.string(), why: z.string() })),
  keywordsAdded: z.array(z.string()),
  keywordsNotAdded: z.array(z.object({ keyword: z.string(), reason: z.string() })),
  placeholdersToFill: z.array(z.string()),
});

const CoverSchema = z.object({
  subject: z.string(), greeting: z.string(), body: z.string().describe("The letter body, paragraphs separated by blank lines"), signoff: z.string(),
  personalTouches: z.array(z.string()).describe("Which details came from the person's profile, so they can check them"),
  placeholders: z.array(z.string()),
});

const ReferralSchema = z.object({
  overview: z.string(),
  targets: z.array(z.object({ who: z.string(), why: z.string(), howToFind: z.string() })),
  searchQueries: z.array(z.object({ where: z.string(), query: z.string(), purpose: z.string() })).describe("LinkedIn searches and Google X-ray queries like site:linkedin.com/in"),
  communities: z.array(z.object({ name: z.string(), how: z.string() })),
  giveFirst: z.array(z.string()).describe("Ways to offer value before asking"),
  messages: z.array(z.object({ channel: z.string(), purpose: z.string(), text: z.string() })),
  timeline: z.array(z.object({ when: z.string(), action: z.string() })),
  avoid: z.array(z.string()),
});

const OutreachSchema = z.object({ variants: z.array(z.object({ label: z.string(), text: z.string() })), tips: z.array(z.string()) });

const CompanySchema = z.object({
  company: z.string(), oneLiner: z.string(), size: z.string(), industry: z.string(), headquarters: z.string(),
  ratings: z.array(z.object({ source: z.string(), rating: z.string(), reviews: z.string(), url: z.string() })),
  pros: z.array(z.string()), cons: z.array(z.string()),
  contractorExperience: z.string().describe("What contractors/freelancers report: pay timeliness, conversion to full-time, treatment"),
  payInsights: z.string(), interviewProcess: z.string(), recentNews: z.array(z.string()),
  redFlags: z.array(z.string()), creativeCulture: z.string().describe("For creative roles: in-house vs agency feel, crunch, credit for work"),
  verdict: z.string(),
});

const WebJobsSchema = z.object({
  jobs: z.array(z.object({ title: z.string(), company: z.string(), location: z.string(), url: z.string(), posted: z.string(), employmentType: z.string(), salary: z.string(), source: z.string(), whyRelevant: z.string() })),
});

const InterviewSchema = z.object({
  likelyQuestions: z.array(z.object({ question: z.string(), whyTheyAsk: z.string(), answerOutline: z.string() })),
  portfolioWalkthrough: z.array(z.string()).describe("Which pieces to show and the story to tell for each"),
  practicalTestTips: z.array(z.string()),
  questionsToAsk: z.array(z.string()),
  thingsToProbe: z.array(z.string()).describe("Red flags or unknowns to ask about (scope, revisions, crunch, contract terms)"),
  rateOrSalaryGuidance: z.string(),
});

const HumanizeSchema = z.object({ text: z.string(), notes: z.array(z.string()) });
const AboutSchema = z.object({ whoIAm: z.string(), whatIDo: z.string(), headline: z.string(), elevatorPitch: z.string(), followUpQuestions: z.array(z.string()) });

// ---------- Tasks ----------

const SYS = "You are a sharp, kind career coach and recruiter who has hired creatives (motion designers, animators, editors, designers) and people in many other fields. You give specific, honest advice.";

function sys(profile, extra = "") {
  return [
    { type: "text", text: `${SYS}\n\n${HONESTY}\n\n${VOICE}${extra ? `\n\n${extra}` : ""}` },
    { type: "text", text: profileBlock(profile), cache_control: { type: "ephemeral" } },
  ];
}

function jobBlock(job) {
  if (!job) return "";
  if (typeof job === "string") return `JOB POSTING\n${job}`;
  return `JOB POSTING\nTitle: ${job.title || ""}\nCompany: ${job.company || ""}\nLocation: ${job.location || ""}\nType: ${job.type || job.employmentType || ""}\nSalary: ${job.salary || ""}\nURL: ${job.url || ""}\n\n${job.description || job.text || ""}`;
}

function resumeBlock(r) {
  if (!r) return "RESUME\n(none provided)";
  return r.structured ? `RESUME (structured JSON)\n${JSON.stringify(r.structured)}` : `RESUME (text)\n${r.text || r}`;
}

export const tasks = {
  async structureResume({ text, profile }) {
    return structured({
      system: sys(profile, "Convert resume text to structured JSON. Copy wording exactly; do not improve anything. Keep sections in their original order and headings exactly as written. Record the visual format conventions you can infer."),
      user: `RESUME TEXT\n${text}`,
      schema: ResumeSchema,
      effort: "low",
    });
  },

  async extractJob({ jobText, profile }) {
    return structured({ system: sys(profile, "Extract the structure of a job posting. Keywords must be literal phrases from the posting."), user: jobBlock(jobText), schema: JobSchema, effort: "low" });
  },

  async evaluate({ resume, job, profile, ats }) {
    return structured({
      system: sys(profile, "Evaluate how well this resume fits the job, the way a hiring manager for this role would. Be honest about long shots; be specific about fixes. For creative roles, remember the portfolio/reel often matters more than the resume."),
      user: `${jobBlock(job)}\n\n${resumeBlock(resume)}\n\nAutomated ATS check (for context): ${JSON.stringify(ats || {})}`,
      schema: EvalSchema,
      effort: "high",
    });
  },

  async tailor({ resume, job, profile, options = {} }) {
    const o = { intensity: "balanced", keepLength: true, ...options };
    const rules = `Tailor the resume to the job while preserving the person's resume FORMAT:
- Keep the same sections, in the same order, with the same headings and the same format conventions (bullet char, date style, heading case, item layout).
- Keep every job title, organization, location and date EXACTLY as given.
- ${o.keepLength ? "Keep roughly the same length: each item keeps its bullet count (±1), bullets stay about as long." : "You may add or remove bullets where it clearly helps."}
- Intensity: ${o.intensity === "light" ? "light touch — swap in exact keywords, reorder bullets, tighten wording" : o.intensity === "bold" ? "bold — rewrite bullets around this job's priorities and rewrite the summary, still truthful" : "balanced — rewrite weak bullets, reorder for relevance, adjust summary and skills ordering"}.
- Work in the job's exact keywords only where truthful. List keywords you could not honestly add and why.
- Put the most relevant experience and skills first within each section.
- Record every meaningful change.`;
    return structured({
      system: sys(profile, rules),
      user: `${jobBlock(job)}\n\n${resumeBlock(resume)}${o.answers ? `\n\nEXTRA FACTS FROM THE PERSON (true, usable):\n${o.answers}` : ""}${o.notes ? `\n\nPERSON'S INSTRUCTIONS:\n${o.notes}` : ""}`,
      schema: TailorSchema,
      effort: "high",
      maxTokens: 32000,
    });
  },

  async coverLetter({ resume, job, profile, options = {} }) {
    const o = { tone: "warm and direct", length: "standard (250-350 words)", format: "letter", ...options };
    return structured({
      system: sys(profile, `Write a cover letter that sounds like this specific person wrote it. Format: ${o.format} (letter = classic letter; email = email body for sending to a person; portal = short note for an application text box; dm = 2-4 sentence message). Tone: ${o.tone}. Length: ${o.length}.
Open with something specific: why this company/team/work, a piece of theirs they admire, or a concrete connection. Mention 2-3 relevant accomplishments with real detail, point to the reel/portfolio, and close with a simple, confident ask. Use details from their profile so it can't be mistaken for a template.`),
      user: `${jobBlock(job)}\n\n${resumeBlock(resume)}${o.hook ? `\n\nTHEIR HOOK / WHY THIS JOB:\n${o.hook}` : ""}${o.notes ? `\n\nNOTES:\n${o.notes}` : ""}${o.recipient ? `\n\nRECIPIENT: ${o.recipient}` : ""}`,
      schema: CoverSchema,
      effort: "high",
    });
  },

  async referralPlan({ job, profile, options = {} }) {
    return structured({
      system: sys(profile, `Build a practical, human networking plan to get a referral or warm intro for this job. Think about: hiring managers, people on the team, recruiters, alumni of the person's school, people from past employers or clients, creative communities (for motion design: Motion Design Slack, School of Motion, Motion Hatch, Motionographer, Animade/Buck alumni, Behance, Instagram, Vimeo, Discords, local meetups like Blend). Messages must be short, specific, generous, never needy or spammy, and written in the person's voice. LinkedIn connection notes must be under 300 characters. Don't ask strangers for a referral in the first message; build rapport and ask for advice or a quick chat first.`),
      user: `${jobBlock(job)}${options.connections ? `\n\nPEOPLE THEY ALREADY KNOW / SCHOOLS / PAST EMPLOYERS:\n${options.connections}` : ""}`,
      schema: ReferralSchema,
      effort: "high",
    });
  },

  async outreach({ profile, options = {} }) {
    return structured({
      system: sys(profile, `Draft outreach messages in the person's own voice. Give 3 variants with different approaches. Keep each tight for the channel (LinkedIn connection note < 300 chars, DM < 600 chars, email < 150 words).`),
      user: `CHANNEL: ${options.channel || "LinkedIn message"}\nRECIPIENT: ${options.recipient || ""}\nWHAT I KNOW ABOUT THEM: ${options.context || ""}\nMY GOAL: ${options.goal || "a 15-minute chat about their team"}\nRELATED JOB: ${options.jobTitle || ""} at ${options.company || ""}\nSTAGE: ${options.stage || "first contact"}`,
      schema: OutreachSchema,
      effort: "medium",
    });
  },

  async companyResearch({ company, profile, role }) {
    return withWebSearch({
      system: sys(profile, `Research an employer for a job seeker. Use web search. Look for employee ratings (Glassdoor, Indeed, Comparably, Blind, Kununu), recent news (layoffs, funding, acquisitions), how they treat contractors/freelancers, pay data, interview process, and for creative roles the creative culture. Only report ratings you actually found, with the URL. If you can't find something, say "Not found".
Finish with ONLY a JSON object in a \`\`\`json block with keys: company, oneLiner, size, industry, headquarters, ratings[{source, rating, reviews, url}], pros[], cons[], contractorExperience, payInsights, interviewProcess, recentNews[], redFlags[], creativeCulture, verdict.`),
      user: `Company: ${company}${role ? `\nRole I'm considering: ${role}` : ""}\nToday is ${new Date().toDateString()}.`,
      schema: CompanySchema,
      maxUses: 10,
    });
  },

  async webJobSearch({ profile, queries, location, maxAgeDays = 30, remoteOnly }) {
    const r = await withWebSearch({
      system: sys(profile, `Find CURRENTLY OPEN job postings that fit this person. Search widely: company career pages, studio sites, LinkedIn, Indeed, Wellfound, and niche boards (for motion design: Motionographer jobs, School of Motion job board, ProductionHUB, Mandy, Working Not Working, Dribbble jobs, Behance jobs, Creativepool, Krop). Only include postings published within the last ${maxAgeDays} days that show no sign of being closed. Each needs a direct URL to the posting. Skip duplicates and aggregator spam.
Finish with ONLY JSON in a \`\`\`json block: {"jobs":[{title, company, location, url, posted, employmentType, salary, source, whyRelevant}]}. Aim for 10-20 jobs.`),
      user: `Searches: ${queries.join("; ")}\nLocation: ${location || "anywhere"}${remoteOnly ? " (remote only)" : ""}\nToday is ${new Date().toDateString()}.`,
      schema: WebJobsSchema,
      maxUses: 12,
    });
    return r;
  },

  async interviewPrep({ resume, job, profile }) {
    return structured({
      system: sys(profile, "Prepare the person for interviews for this job. Include portfolio walkthrough advice for creative roles, practical/design test tips, and pay guidance (for contract roles, a day/hourly rate approach). Answer outlines should use the person's real experience from the resume."),
      user: `${jobBlock(job)}\n\n${resumeBlock(resume)}`,
      schema: InterviewSchema,
      effort: "high",
    });
  },

  async humanize({ text, profile, purpose }) {
    return structured({
      system: sys(profile, "Rewrite the text so it sounds like this person wrote it on a good day: specific, natural, confident, no clichés. Keep facts identical. Then list what you changed."),
      user: `PURPOSE: ${purpose || "job application writing"}\n\nTEXT:\n${text}`,
      schema: HumanizeSchema,
      effort: "medium",
    });
  },

  async aboutDraft({ profile, answers }) {
    return structured({
      system: sys(profile, "Help the person describe themselves. Draft their 'who I am' and 'what I do' in first person and in their voice, a resume-style headline, and a 20-second elevator pitch. Then ask 3-5 follow-up questions that would make it more specific."),
      user: `THEIR ROUGH ANSWERS:\n${answers || "(use the profile)"}`,
      schema: AboutSchema,
      effort: "medium",
    });
  },
};
