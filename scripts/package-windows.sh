#!/usr/bin/env bash
# Builds dist/CareerCopilot-Windows.zip: a portable copy of the app with its own
# node.exe and all dependencies installed. Unzip, double-click, done.
# Usage: scripts/package-windows.sh   (needs node, npm, curl, zip)
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.23.4}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
WORK="$(mktemp -d)"
OUT="$WORK/CareerCopilot"
trap 'rm -rf "$WORK"' EXIT

echo "Fetching Windows node.exe $NODE_VERSION…"
(cd "$WORK" && npm pack --silent "node-win-x64@$NODE_VERSION" >/dev/null && mkdir nodepkg && tar -xzf "node-win-x64-$NODE_VERSION.tgz" -C nodepkg)
NODE_EXE="$WORK/nodepkg/package/bin/node.exe"

# Only ship a node.exe whose hash matches the official nodejs.org checksum.
EXPECTED="$(curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | awk '$2=="win-x64/node.exe"{print $1}')"
ACTUAL="$(sha256sum "$NODE_EXE" | awk '{print $1}')"
if [[ -z "$EXPECTED" || "$EXPECTED" != "$ACTUAL" ]]; then
  echo "node.exe checksum mismatch (expected '$EXPECTED', got '$ACTUAL'). Aborting." >&2
  exit 1
fi
echo "node.exe checksum matches nodejs.org."

mkdir -p "$OUT/app" "$OUT/node"
cp "$NODE_EXE" "$OUT/node/node.exe"
cp -r "$ROOT/server.js" "$ROOT/lib" "$ROOT/public" "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/README.md" "$OUT/app/"
# Dependencies are pure JavaScript, so a Linux install works on Windows.
(cd "$OUT/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent)

# Windows files need CRLF line endings.
crlf() { sed 's/$/\r/' > "$1"; }

crlf "$OUT/Start Career Copilot.bat" <<'BAT'
@echo off
title Career Copilot
if not exist "%~dp0node\node.exe" (
  echo.
  echo  Career Copilot needs to be unzipped first.
  echo  Right-click the zip file, choose "Extract All...", then open the extracted folder
  echo  and double-click "Start Career Copilot" again.
  echo.
  pause
  exit /b 1
)
cd /d "%~dp0app"
set OPEN_BROWSER=1
echo.
echo  Starting Career Copilot... your browser will open at http://localhost:5317
echo  Keep this window open while you use the app. Close it to stop the app.
echo.
"%~dp0node\node.exe" server.js
echo.
echo  Career Copilot stopped.
pause
BAT

crlf "$OUT/READ ME FIRST.txt" <<'TXT'
CAREER COPILOT - how to run it
==============================

1. Make sure this folder is unzipped (not opened inside the zip).
2. Double-click "Start Career Copilot".
   - If Windows shows "Windows protected your PC", click "More info" then "Run anyway".
     (It's a plain script that starts the app; it isn't signed by a publisher.)
3. Your browser opens at http://localhost:5317. If it doesn't, open that address yourself.
4. Keep the black window open while you use the app. Close it to stop.

Nothing to install. The app runs only on this computer; nobody else can reach it.

YOUR DATA
Everything you enter (profile, resumes, tracker, API keys) is saved in the "app\data" folder
inside this folder. Keep this folder to keep your data. To move to a newer version, copy
"app\data" into the new folder's "app" folder.

QUICK TEST (no API key needed)
- Jobs: click Search. You should see real, recent motion design jobs.
- Resumes: drop in your resume (PDF or DOCX) and look at the "Plain text" tab.
- ATS Check: paste a job description and see your score and missing keywords.
- Tracker: on a job card click "Track", then move it to Applied.

AI FEATURES (optional)
Evaluate, tailor, cover letters, outreach, company research and interview prep need an
Anthropic API key: console.anthropic.com -> API keys (add billing credit first).
Paste it in the app under Settings. AI calls take 30-90 seconds and bill your Anthropic account.

More detail: app\README.md
TXT

mkdir -p "$DIST"
rm -f "$DIST/CareerCopilot-Windows.zip"
(cd "$WORK" && zip -qr -9 "$DIST/CareerCopilot-Windows.zip" CareerCopilot)
echo "Built $DIST/CareerCopilot-Windows.zip ($(du -h "$DIST/CareerCopilot-Windows.zip" | cut -f1))"
