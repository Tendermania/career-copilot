# Career Copilot — build brief

A local-first web app (Node server + browser UI) that helps one person run their job search.
Primary focus is **motion graphics / motion design**, but everything must work for any field:
the active "job focus" and resume are swappable.

The owner is a motion designer (After Effects, Rive, Illustrator, Photoshop, Framer; portfolio
site built in Framer). They will paste/upload their own resume in the app. Never commit a resume
or API keys: all user data lives in `data/` (gitignored).

## What it must do

1. **Profile / "who I am"** (the human aspect): name, headline, links, who I am, what I do,
   proudest work, values, work style, career story, goals, deal-breakers, preferences
   (remote/hybrid/on-site, employment types, minimum pay, locations), and *voice samples* so
   generated writing sounds like them. Multiple **job focuses** (label, target roles, keywords,
   avoid-keywords, industries, seniority), one active, swappable in one click. An "help me write
   this" button (`aboutDraft` task) that drafts About text from rough answers.
2. **Resumes**: upload PDF/DOCX/TXT or paste text; keep several versions; pick the active one.
   Parse to text (server: `mammoth` for DOCX incl. table/image detection, `unpdf` for PDF),
   then Claude converts to structured JSON (`structureResume`) that also records the format
   conventions (bullet char, date style, heading case, item layout, page count).
3. **Evaluate resume vs. a job**: paste a job (or pick one from search). Show the deterministic
   ATS report (`lib/ats.js`) instantly, then the AI evaluation (`evaluate`): fit score, verdict,
   recommendation, 6-second recruiter read, strengths with evidence, gaps (dealbreaker/major/
   minor + status), section feedback, portfolio/reel advice, and *questions only you can answer*
   whose answers feed back into tailoring.
4. **Tailor while keeping the format**: `tailor` task, intensity light/balanced/bold, keep-length
   toggle, optional extra facts + instructions. After the model returns, enforce the format lock
   server-side: same section order/headings; copy every original item's title/organization/
   location/dates back by index when counts match; warn on anything that differs. Show a
   before/after diff with accept/reject per change, list keywords added and not added (with
   reasons), and placeholders like `[# videos/month]` to fill in. Re-run ATS on the result to
   show the score change.
5. **Export**: render the structured resume in an "Original format" template (mirrors detected
   conventions) plus Classic / Modern / Compact single-column ATS-safe templates. Print-to-PDF
   via print CSS, DOCX via the `docx` package (server), plain-text ATS version, copy-to-clipboard.
6. **ATS-proofing service**: dedicated tab. Parsing risks (tables, images, multi-column, icons,
   too little extractable text), standard headings, contact/portfolio links, keyword match
   with matched/missing lists, years-of-experience check, title match, writing-quality checks,
   plus the tips in `ATS_TIPS`. Also flags AI-sounding phrases (`findAiTells` in `lib/text.js`).
7. **Job search across the web** (`lib/jobs.js`, done): Remotive, Himalayas, Jobicy, RemoteOK,
   The Muse, Arbeitnow, Greenhouse/Lever/Ashby company boards (defaults in `lib/store.js`,
   editable), plus keyed Adzuna, JSearch (LinkedIn/Indeed/Glassdoor via RapidAPI), USAJOBS,
   and an AI web-search source (`webJobSearch`) for studio sites and niche boards
   (Motionographer, School of Motion, ProductionHUB, Mandy, Working Not Working…).
   **Only ongoing jobs**: drop expired and older-than-N-days postings, dedupe across sources
   (show "also on"), and a "Verify still open" button per job (`verifyPosting`) plus a
   "verify all shown" bulk action. Each job shows employment type (Full-time, Part-time,
   Contract, Contract-to-hire, Freelance, Internship), remote, salary, fit score with reasons,
   missing skills, and flags (staffing agency, scam language, unpaid/spec work, no pay listed,
   1099 tax note). Filters: type, remote, source, min fit, posted within. Save jobs.
8. **Company check**: `companyResearch` (Claude + web search): ratings with source URLs
   (Glassdoor, Indeed, Comparably, Blind…), pros/cons, contractor experience, pay, interview
   process, news/layoffs, red flags, creative culture, verdict. Cache per company in
   `data/companies.json` for 14 days. Reachable from any job card.
9. **Referrals & networking**: `referralPlan` (who to target, how to find them, LinkedIn and
   Google X-ray search strings, communities, give-first ideas, message templates, a timeline,
   what to avoid) and `outreach` (3 voice-matched variants per channel/stage). Copy buttons,
   char counters (LinkedIn connection note < 300).
10. **Cover letters**: `coverLetter` with tone, length, format (letter / email / portal box / DM),
    hook ("why this job"), recipient. Editable output, AI-tell highlighting, "make it sound
    more like me" (`humanize`), export DOCX/TXT.
11. **Interview prep**: `interviewPrep` (likely questions + answer outlines from real
    experience, portfolio walkthrough, practical-test tips, questions to ask, things to probe,
    rate/salary guidance).
12. **Application tracker**: saved → applied → interviewing → offer / rejected / ghosted, with
    dates, contacts, notes, follow-up date, which resume version and cover letter were used.
    Dashboard shows follow-ups due, new matches, and next actions.
13. **Settings**: Anthropic API key, model (default `claude-opus-5-5`), server-side fallbacks
    toggle (on by default), Adzuna/RapidAPI/USAJOBS keys, company board lists. Show which
    sources are active. Everything without a key (ATS check, free job sources, tracker) must
    still work.

**Human aspect throughout**: every AI output is editable before use; nothing is auto-sent;
honesty rules (in `lib/ai.js`) forbid inventing experience; outreach advice favors genuine
relationships over spam; voice samples shape all writing.

## Status (handoff from the local session, 2026-10-31)

Done and in this repo:
- `package.json` (ESM; deps `@anthropic-ai/sdk@1.3.0`, `zod@4`, `mammoth`, `unpdf`, `docx`).
- `lib/store.js`: JSON-file store in `data/`, settings with env fallbacks, `.env` loader,
  verified default company boards.
- `lib/text.js`: HTML strip, skill vocabulary with aliases (motion graphics heavy), keyword
  matching, phrase extraction, AI-tell detector.
- `lib/ats.js`: deterministic ATS analyzer.
- `lib/jobs.js`: all source adapters (field names verified against live responses on
  2026-10-31), type classification, flags, fit scoring, freshness/dedupe, `verifyPosting`.
- `lib/ai.js`: all Claude tasks with zod schemas. Uses `client.beta.messages.create` with
  `betas: ["server-side-fallback-2026-07-01"], fallbacks: "default"` (retries without on a
  fallback-related 400), structured outputs via `output_config.format` (json_schema from
  `zodOutputFormat`), `web_search_20260209` with `pause_turn` resume for web tasks.
  Thinking is always on for Opus 5.5; depth is set with `output_config.effort`.

Not done yet (do these):
1. `lib/files.js`: parse uploads (base64 JSON body → text + `{type, hasTables, hasImages,
   textLength, pages, multiColumn}`), and DOCX export of a structured resume / cover letter.
2. `server.js`: `node:http` server (no Express), static `public/`, JSON API:
   `GET/PUT /api/state/:key` (keys allowed in store), `GET /api/status`, `POST /api/parse`,
   `POST /api/ats`, `POST /api/ai/:task`, `POST /api/jobs/search`, `POST /api/jobs/verify`,
   `POST /api/export/docx`, `GET /api/sources`. Never return API keys to the client (mask them).
   Port 5317 by default (`PORT` env). Bind to 127.0.0.1.
3. `public/` UI: vanilla JS single page (`index.html`, `app.js`, `styles.css`), tabs:
   Dashboard, Profile, Resumes, Evaluate & Tailor, ATS Check, Jobs, Companies, Networking,
   Cover Letters, Interview Prep, Tracker, Settings. Clean, calm design; light + dark; works
   on a laptop and a phone. Loading states for AI calls (they can take 30-90 s).
4. `README.md`: what it is, setup (`npm install`, `npm start`, open http://localhost:5317),
   where to get each key, privacy note (data stays in `data/`), cost note.
5. Test: run the server, hit every endpoint (job search with free sources must return real
   jobs), exercise the UI. AI endpoints need a key; if none is available, at least verify
   request construction and error handling.
