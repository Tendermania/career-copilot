// Tiny JSON-file store. Everything lives in ./data so it stays on this machine.
import { COMPAT, fieldsFor } from "./providers.js";
import { APP_DIR } from "./paths.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DATA_DIR = path.join(APP_DIR, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const ALLOWED = new Set(["profile", "resumes", "tracker", "saved-jobs", "settings", "companies", "documents"]);

export function isAllowedKey(key) {
  return ALLOWED.has(key);
}

export function read(key, fallback = null) {
  const file = path.join(DATA_DIR, `${key}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  const file = path.join(DATA_DIR, `${key}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
  return value;
}

// Settings merge env vars underneath saved values so a .env works too.
export function settings() {
  const saved = read("settings", {}) || {};
  const compat = {};
  for (const [id, p] of Object.entries(COMPAT)) {
    const f = fieldsFor(id), ENV = id.toUpperCase();
    compat[f.key] = saved[f.key] || process.env[`${ENV}_API_KEY`] || "";
    compat[f.model] = saved[f.model] || process.env[`${ENV}_MODEL`] || p.model;
    compat[f.base] = saved[f.base] || process.env[`${ENV}_BASE_URL`] || p.base;
  }
  return {
    ...compat,
    aiProvider: saved.aiProvider || process.env.AI_PROVIDER || "claude",
    anthropicApiKey: saved.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "",
    model: saved.model || process.env.CLAUDE_MODEL || "claude-opus-5-5",
    adzunaAppId: saved.adzunaAppId || process.env.ADZUNA_APP_ID || "",
    adzunaAppKey: saved.adzunaAppKey || process.env.ADZUNA_APP_KEY || "",
    adzunaCountry: saved.adzunaCountry || "us",
    rapidApiKey: saved.rapidApiKey || process.env.RAPIDAPI_KEY || "",
    usajobsKey: saved.usajobsKey || process.env.USAJOBS_KEY || "",
    usajobsEmail: saved.usajobsEmail || process.env.USAJOBS_EMAIL || "",
    greenhouseBoards: saved.greenhouseBoards ?? DEFAULT_BOARDS.greenhouse,
    leverBoards: saved.leverBoards ?? DEFAULT_BOARDS.lever,
    ashbyBoards: saved.ashbyBoards ?? DEFAULT_BOARDS.ashby,
    useFallbacks: saved.useFallbacks ?? true,
  };
}

// Company career boards verified to answer on 2026-10-31. Edit in Settings.
export const DEFAULT_BOARDS = {
  greenhouse: ["duolingo", "discord", "airbnb", "pinterest", "reddit", "dropbox", "figma", "twitch", "riotgames", "epicgames", "squarespace", "robinhood", "lyft", "peloton", "roblox"],
  lever: ["matchgroup"],
  ashby: ["notion", "linear", "openai", "ramp", "runway", "perplexity", "elevenlabs", "pika"],
};

// Load a local .env (KEY=value lines) without a dependency.
export function loadDotEnv() {
  const file = path.join(APP_DIR, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
