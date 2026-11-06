// Tiny JSON-file store. Everything lives in ./data so it stays on this machine.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, "..", "data");
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
  return {
    aiProvider: saved.aiProvider || process.env.AI_PROVIDER || "claude",
    anthropicApiKey: saved.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "",
    deepseekApiKey: saved.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "",
    deepseekModel: saved.deepseekModel || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
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
  const file = path.join(here, "..", ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
