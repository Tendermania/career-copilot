// Deterministic ATS (applicant tracking system) checks. No AI needed, so it runs
// instantly and gives the same answer every time. The AI review layers on top.
import { norm, findSkills, topPhrases, containsTerm, SKILLS } from "./text.js";

const STANDARD_HEADINGS = {
  experience: ["experience", "work experience", "professional experience", "employment", "work history", "relevant experience"],
  education: ["education", "academic background"],
  skills: ["skills", "technical skills", "core skills", "software", "tools", "expertise", "competencies"],
  summary: ["summary", "profile", "professional summary", "about"],
};

const ACTION_VERBS = ["animated", "designed", "created", "built", "led", "directed", "produced", "developed", "launched", "managed", "delivered", "edited", "composited", "modeled", "rigged", "illustrated", "storyboarded", "collaborated", "increased", "reduced", "improved", "grew", "drove", "owned", "shipped", "established", "streamlined", "pitched", "art directed", "mentored", "redesigned", "automated", "optimized", "won"];

function lines(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function detectHeadings(text) {
  const out = {};
  const ls = lines(text);
  for (const [kind, names] of Object.entries(STANDARD_HEADINGS)) {
    out[kind] = ls.some((l) => {
      const n = norm(l).replace(/[:]/g, "");
      return l.length < 40 && names.some((h) => n === h || n.startsWith(h + " "));
    });
  }
  return out;
}

function bullets(text) {
  return lines(text).filter((l) => /^([•\-*–▪●◦■►✓]|\d+\.)\s*/.test(l) || (l.length > 50 && /^[A-Z][a-z]+ed\b/.test(l)));
}

function yearsRequired(jd) {
  const m = [...String(jd).matchAll(/(\d{1,2})\s*\+?\s*(?:-|to)?\s*(\d{1,2})?\s*\+?\s*years?/gi)];
  if (!m.length) return null;
  return Math.max(...m.map((x) => Number(x[1])).filter((n) => n < 30));
}

function estimateYears(resume) {
  const yrs = [...String(resume).matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((m) => Number(m[1]));
  const present = /\b(present|current|now)\b/i.test(resume);
  if (!yrs.length) return null;
  const max = present ? new Date().getFullYear() : Math.max(...yrs);
  return Math.max(0, max - Math.min(...yrs));
}

/**
 * @param {object} p
 * @param {string} p.resumeText
 * @param {string} [p.jobText]
 * @param {object} [p.fileMeta] facts from the parser: {type, hasTables, hasImages, textLength, pages}
 * @param {string[]} [p.extraKeywords] keywords from the AI extraction, if any
 */
export function analyze({ resumeText = "", jobText = "", jobTitle = "", fileMeta = {}, extraKeywords = [] }) {
  const resume = String(resumeText);
  const rNorm = norm(resume);
  const issues = []; // {severity: high|medium|low, area, message, fix}
  const add = (severity, area, message, fix) => issues.push({ severity, area, message, fix });

  // ---- Parsing / format ----
  let parseScore = 100;
  if (resume.trim().length < 300) {
    parseScore -= 60;
    add("high", "Parsing", "Very little text could be extracted. ATS software would see a nearly blank resume.", "If this is a designed PDF exported from Illustrator/InDesign/Photoshop, export with live text (not outlines) or keep a plain DOCX version for applications.");
  }
  if (fileMeta.hasTables) {
    parseScore -= 15;
    add("medium", "Parsing", "The file uses tables. Some ATS (older Taleo, iCIMS) read table cells out of order.", "Use a single-column layout with plain paragraphs and tabs for alignment.");
  }
  if (fileMeta.hasImages) {
    parseScore -= 10;
    add("medium", "Parsing", "The file contains images or graphics. Any text inside them is invisible to an ATS.", "Keep logos, skill bars and icons out of the application copy; put the visual version on your portfolio.");
  }
  if (fileMeta.multiColumn) {
    parseScore -= 15;
    add("medium", "Parsing", "Text looks like it comes from a multi-column layout (lines interleave).", "Use one column for the ATS version.");
  }
  const glyphs = (resume.match(/[☀-➿-\u{1F300}-\u{1FAFF}]/gu) || []).length;
  if (glyphs > 3) {
    parseScore -= 8;
    add("low", "Parsing", `${glyphs} icon/emoji characters found. They can turn into garbage characters.`, "Replace icons with words (\"Email:\", \"Portfolio:\").");
  }
  if (/\b(references available|curriculum vitae)\b/i.test(resume)) add("low", "Content", "\"References available upon request\" wastes a line.", "Delete it.");

  // ---- Sections ----
  const headings = detectHeadings(resume);
  let sectionScore = 100;
  if (!headings.experience) { sectionScore -= 35; add("high", "Sections", "No standard \"Experience\" heading found.", "Use a plain heading like \"Experience\" or \"Work Experience\" so the ATS maps your jobs."); }
  if (!headings.skills) { sectionScore -= 25; add("medium", "Sections", "No \"Skills\" heading found.", "Add a \"Skills\" section listing software (After Effects, Cinema 4D, ...) as plain text."); }
  if (!headings.education) { sectionScore -= 15; add("low", "Sections", "No \"Education\" heading found.", "Add \"Education\" even if it's a certificate or self-taught program (e.g. School of Motion)."); }

  // ---- Contact ----
  const contact = {
    email: /[\w.+-]+@[\w-]+\.[\w.]+/.test(resume),
    phone: /(\+?\d[\d\s().-]{8,}\d)/.test(resume),
    linkedin: /linkedin\.com\//i.test(resume),
    portfolio: /(behance|vimeo|dribbble|artstation|youtube|\.com|\.design|\.studio|\.io|\.me|\.co)\b/i.test(resume.replace(/linkedin\.com\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/gi, "")),
  };
  let contactScore = 100;
  if (!contact.email) { contactScore -= 40; add("high", "Contact", "No email address found.", "Put your email in the top lines as plain text."); }
  if (!contact.phone) { contactScore -= 15; add("low", "Contact", "No phone number found.", "Add a phone number; many recruiter workflows expect one."); }
  if (!contact.portfolio) { contactScore -= 30; add("high", "Contact", "No portfolio/reel link detected.", "For creative roles the reel is the real resume. Add a short portfolio URL near your name."); }
  if (!contact.linkedin) { contactScore -= 10; add("low", "Contact", "No LinkedIn URL.", "Add it; recruiters cross-check."); }

  // ---- Writing quality ----
  const bl = bullets(resume);
  const quantified = bl.filter((b) => /\d|%|\$/.test(b)).length;
  const actionStart = bl.filter((b) => ACTION_VERBS.some((v) => norm(b).replace(/^[^a-z]+/, "").startsWith(v))).length;
  const pronouns = (resume.match(/\b(I|me|my)\b/g) || []).length;
  const longBullets = bl.filter((b) => b.length > 220).length;
  const words = resume.split(/\s+/).filter(Boolean).length;
  let writingScore = 100;
  if (bl.length && quantified / bl.length < 0.3) { writingScore -= 20; add("medium", "Impact", `Only ${quantified} of ${bl.length} bullets have numbers.`, "Add scale: views, deliverables per week, turnaround time, client names, budget, audience size."); }
  if (bl.length && actionStart / bl.length < 0.5) { writingScore -= 10; add("low", "Impact", "Many bullets don't start with an action verb.", "Start bullets with verbs like Animated, Designed, Directed, Delivered."); }
  if (pronouns > 3) { writingScore -= 8; add("low", "Tone", `First-person words used ${pronouns} times.`, "Resumes usually drop \"I/my\"."); }
  if (longBullets) { writingScore -= 8; add("low", "Readability", `${longBullets} bullet(s) run past ~2 lines.`, "Split or trim long bullets."); }
  if (words > 1100) { writingScore -= 10; add("medium", "Length", `About ${words} words; likely over 2 pages.`, "Aim for 1 page (under ~8 years) or 2 pages max."); }
  if (words < 180 && resume.length >= 300) { writingScore -= 10; add("medium", "Length", `Only about ${words} words.`, "Add detail to your strongest roles."); }

  // Dates
  const dateStyles = new Set();
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}/i.test(resume)) dateStyles.add("Mon YYYY");
  if (/\b\d{1,2}\/\d{4}\b/.test(resume)) dateStyles.add("MM/YYYY");
  if (/\b\d{1,2}\/\d{2}\b/.test(resume)) dateStyles.add("MM/YY");
  if (dateStyles.size > 1) { writingScore -= 5; add("low", "Dates", `Mixed date formats (${[...dateStyles].join(", ")}).`, "Pick one format; \"Jan 2023 – Present\" parses everywhere."); }

  // ---- Keywords vs job ----
  let keyword = null;
  if (jobText && jobText.trim().length > 50) {
    const jobSkills = findSkills(jobText);
    const phrases = topPhrases(jobText, 30).filter((p) => !jobSkills.some((s) => norm(s) === p));
    const extra = (extraKeywords || []).filter(Boolean);
    const terms = [...new Set([...jobSkills, ...extra, ...phrases.slice(0, 15)])];
    const isMatched = (t) => {
      const aliases = SKILLS[t] || [t];
      return [t, ...aliases].some((a) => containsTerm(rNorm, a));
    };
    const matched = terms.filter(isMatched);
    const missing = terms.filter((t) => !isMatched(t));
    // Skills and AI-extracted terms count double: those are what recruiters filter on.
    const weight = (t) => (SKILLS[t] || extra.includes(t) ? 2 : 1);
    const total = terms.reduce((s, t) => s + weight(t), 0) || 1;
    const got = matched.reduce((s, t) => s + weight(t), 0);
    const reqYears = yearsRequired(jobText);
    const haveYears = estimateYears(resume);
    const titleHit = jobTitle ? containsTerm(rNorm, norm(jobTitle).split(" ").slice(-2).join(" ")) : null;
    keyword = {
      score: Math.round((got / total) * 100),
      matched,
      missing,
      requiredYears: reqYears,
      estimatedYears: haveYears,
      titleMatch: titleHit,
    };
    if (keyword.score < 60) add("high", "Keywords", `Keyword match is ${keyword.score}%. Many ATS rankings and recruiter searches use exact terms.`, `Work in the missing terms you genuinely have: ${missing.slice(0, 8).join(", ")}.`);
    if (reqYears && haveYears != null && haveYears < reqYears) add("medium", "Experience", `Job asks for ${reqYears}+ years; your resume dates span about ${haveYears}.`, "Count freelance, internships and long personal projects with dates if they're real experience.");
    if (titleHit === false) add("low", "Keywords", `The job title "${jobTitle}" doesn't appear in your resume.`, "If honest, mirror the title in your headline or summary (e.g. \"Motion Designer\").");
  }

  const parts = { parsing: clamp(parseScore), sections: clamp(sectionScore), contact: clamp(contactScore), writing: clamp(writingScore) };
  const base = (parts.parsing * 0.3 + parts.sections * 0.2 + parts.contact * 0.15 + parts.writing * 0.35);
  const overall = keyword ? Math.round(base * 0.5 + keyword.score * 0.5) : Math.round(base);
  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    overall,
    parts,
    keyword,
    contact,
    headings,
    stats: { words, bullets: bl.length, quantified, actionStart, skillsFound: findSkills(resume) },
    issues,
    tips: ATS_TIPS,
  };
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export const ATS_TIPS = [
  "Submit DOCX unless the posting asks for PDF. Workday, Taleo and iCIMS parse DOCX most reliably; Greenhouse, Lever and Ashby handle text-based PDFs fine.",
  "Keep a designed resume for humans (portfolio, email to a person) and a plain single-column version for upload forms.",
  "Name the file like \"Firstname-Lastname-Motion-Designer.pdf\".",
  "Put links as full text (yourname.com/reel), not only as hyperlinked words.",
  "Don't hide keywords in white text. Modern ATS and recruiters flag it, and it reads as dishonest.",
  "Mirror the exact wording from the posting where it's true for you (\"Cinema 4D\", not just \"3D\").",
  "Many ATS filter by knockout questions (location, work authorization, salary). Answer those carefully; they matter more than the resume score.",
];
