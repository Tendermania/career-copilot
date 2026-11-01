# Career Copilot

A local-first job search assistant. It runs on your own computer: a small Node server plus a
browser UI. Built for motion designers first, and works for any field.

- **Resumes**: upload PDF/DOCX/TXT or paste, keep versions, preview in four templates
  (your original format, Classic, Modern, Compact), print to PDF, export DOCX or plain text.
- **ATS check**: parsing risks (tables, images, columns, text boxes), headings, contact and
  portfolio links, keyword match against a job, years of experience, writing quality, and
  generic or AI-sounding phrases. Instant, no AI needed.
- **Evaluate & tailor**: an honest fit evaluation, then a tailored resume that keeps your
  format. Titles, companies, dates and section order are locked to your original. You
  accept or reject every change.
- **Jobs**: currently open postings from Remotive, Himalayas, Jobicy, RemoteOK, The Muse,
  Arbeitnow and company boards (Greenhouse, Lever, Ashby). Optional keyed sources: Adzuna,
  JSearch (LinkedIn/Indeed/Glassdoor via Google for Jobs) and USAJOBS. An optional AI web search
  covers studio sites and niche boards (Motionographer, School of Motion, ProductionHUB…).
  Expired and old postings are dropped and duplicates merged. Each job shows its type
  (full-time, contract, freelance…), pay, fit score and red flags. A "Verify still open"
  check is built in.
- **Company check**: ratings with links, contractor experience, pay, interview process,
  news and red flags (cached for 14 days).
- **Networking**: referral plan (who to reach, LinkedIn and Google X-ray searches,
  communities, timeline) and outreach drafts with character counters.
- **Cover letters and interview prep**, written from your profile and voice samples.
- **Tracker**: saved → applied → interviewing → offer, with follow-up reminders.

Every AI output is editable, and nothing is ever sent for you. The AI has honesty rules: it
won't invent experience. Where a number would help, it leaves a placeholder like
`[# videos/month]` for you to fill in.

## Setup

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/Tendermania/career-copilot.git
```

```bash
cd career-copilot
```

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:5317. To use another port: `PORT=8080 npm start`.

Start in **Profile** (who you are, plus a few voice samples), then add your resume in
**Resumes**. The default job focus is *Motion graphics* (Motion Designer, Motion Graphics
Designer, Animator, 2D/3D Motion Designer, Video Editor; After Effects, Cinema 4D, Rive,
Lottie, Illustrator, Photoshop, Premiere Pro). Edit it or add more focuses for other fields,
then switch focus from the top bar.

## Keys

Without any keys you get the ATS checker, all free job sources, saved jobs and the tracker.
Add keys in **Settings** (or in a `.env` file, see below).

| Key | What it turns on | Where to get it |
| --- | --- | --- |
| Anthropic API key | Evaluation, tailoring, resume structuring, cover letters, outreach, referral plans, interview prep, company research, AI web job search | [console.anthropic.com](https://console.anthropic.com/settings/keys) → API keys (add billing credit) |
| Adzuna app ID + key | Adzuna (large job aggregator) | [developer.adzuna.com](https://developer.adzuna.com/) → register → create an app |
| RapidAPI key | JSearch: LinkedIn, Indeed, Glassdoor, ZipRecruiter via Google for Jobs | [rapidapi.com](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) → subscribe to JSearch (free plan) → copy `X-RapidAPI-Key` |
| USAJOBS key + email | US federal jobs | [developer.usajobs.gov](https://developer.usajobs.gov/apirequest/) → request an API key (use the same email in Settings) |

Optional `.env` in the project folder (values saved in Settings take priority):

```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-opus-5-5
ADZUNA_APP_ID=...
ADZUNA_APP_KEY=...
RAPIDAPI_KEY=...
USAJOBS_KEY=...
USAJOBS_EMAIL=you@example.com
```

**Model.** The default is `claude-opus-5-5`. You can switch to a cheaper, faster model
(for example `claude-sonnet-5-5`) in Settings.

**Server-side fallbacks** are **on by default**. If the model declines a request, Anthropic
retries it on a fallback model, so you still get an answer. Turn this off in Settings if you
want only the model you picked. The app automatically retries without fallbacks if a model
doesn't support them.

**Company boards.** Settings lists the Greenhouse, Lever and Ashby boards that get searched.
Add studios you'd like to work at; the board name is the last part of their careers URL
(for example `boards.greenhouse.io/figma` → `figma`).

## Privacy

- Everything you enter is saved as JSON in the `data/` folder: profile, resumes, letters,
  tracker, settings and API keys. `data/` and `.env` are in `.gitignore`.
- **This repository is public. Never commit a resume, `data/`, `.env` or any key.** Check
  `git status` before you commit.
- The server only listens on `127.0.0.1`, so other devices on your network can't reach it.
  It rejects requests from other websites.
- API keys are never sent back to the browser, only a masked version (`sk-a••••7890`).
- Text goes to Anthropic only when you press an AI button. Job searches call the job boards
  directly from your computer.

## Cost

- Everything without AI is free.
- AI features bill your Anthropic account by tokens; see [anthropic.com/pricing](https://www.anthropic.com/pricing).
  Tailoring and evaluation are the largest calls (whole resume + job + detailed output).
  Short tasks like outreach or the About helper are small.
- Company research and AI web job search also run web searches, billed per search on top of
  tokens. Company results are cached for 14 days. The AI web job search source is
  unchecked by default.
- To spend less, switch the model to Sonnet in Settings and use the free sources for
  everyday searching.
- AI calls usually take 30–90 seconds. You can switch tabs while one runs.

## Troubleshooting

- **"No Anthropic API key yet"**: add it in Settings. Everything else works without it.
- **A job source shows "failed"**: usually temporary (site down or rate-limited). Other sources
  still return results.
- **Behind a corporate proxy**: Node's `fetch` ignores `HTTPS_PROXY` unless you start with
  `NODE_USE_ENV_PROXY=1 npm start` (Node 22.21+).
- **Old `.doc` files** can't be read; save as DOCX or PDF first.
- **Designed PDFs** (Illustrator/InDesign with outlined text) may yield almost no text. The ATS
  check will tell you; keep a plain DOCX version for applications.

## Project layout

```
server.js        local HTTP server + JSON API (no framework)
lib/store.js     JSON file store in data/, settings, .env loader
lib/files.js     PDF/DOCX/TXT parsing, DOCX export
lib/ats.js       deterministic ATS analyzer
lib/text.js      skill vocabulary, keyword matching, AI-tell detector
lib/jobs.js      job board adapters, type classification, flags, fit, verify
lib/ai.js        Claude tasks (structured outputs, web search)
public/          the UI (index.html, styles.css, app.js); no build step
```

API (all JSON, localhost only): `GET /api/status`, `GET /api/sources`,
`GET|PUT /api/state/:key`, `POST /api/parse`, `POST /api/ats`, `POST /api/ai/:task`,
`POST /api/jobs/search`, `POST /api/jobs/verify`, `POST /api/export/docx`.
