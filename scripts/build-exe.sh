#!/usr/bin/env bash
# Builds dist/CareerCopilot.exe: one Windows executable with the app, its UI and every dependency inside.
# Needs: node 22, npm, curl, python3.   Usage: scripts/build-exe.sh      (TARGET=linux builds a Linux binary for testing)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="$(node -p 'process.versions.node')"
TARGET="${TARGET:-win}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$ROOT/dist"
cd "$ROOT"

echo "Bundling…"
npm install --silent --no-save esbuild postject >/dev/null
npx esbuild server.js --bundle --platform=node --format=cjs --target=node22 --define:import.meta.url=undefined --outfile="$WORK/bundle.js" --log-level=error

# every file in public/ is embedded under its own name
node -e '
const fs = require("fs"), path = require("path"), root = process.argv[1], work = process.argv[2];
const assets = {}; for (const f of fs.readdirSync(path.join(root, "public"))) assets[f] = path.join(root, "public", f);
fs.writeFileSync(path.join(work, "sea-config.json"), JSON.stringify({ main: path.join(work, "bundle.js"), output: path.join(work, "app.blob"), disableExperimentalSEAWarning: true, assets }));
' "$ROOT" "$WORK"
node --experimental-sea-config "$WORK/sea-config.json"

if [[ "$TARGET" == "win" ]]; then
  OUT="$ROOT/dist/CareerCopilot.exe"
  echo "Fetching Windows node.exe $NODE_VERSION…"
  (cd "$WORK" && npm pack --silent "node-win-x64@$NODE_VERSION" >/dev/null && mkdir nodepkg && tar -xzf "node-win-x64-$NODE_VERSION.tgz" -C nodepkg)
  cp "$WORK/nodepkg/package/bin/node.exe" "$OUT"
  EXPECTED="$(curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | awk '$2=="win-x64/node.exe"{print $1}')"
  ACTUAL="$(sha256sum "$OUT" | awk '{print $1}')"
  [[ -n "$EXPECTED" && "$EXPECTED" == "$ACTUAL" ]] || { echo "node.exe checksum mismatch, aborting" >&2; exit 1; }
  echo "node.exe checksum matches nodejs.org."
else
  OUT="$ROOT/dist/career-copilot-linux"; cp "$(command -v node)" "$OUT"
fi
npx postject "$OUT" NODE_SEA_BLOB "$WORK/app.blob" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 >/dev/null 2>&1
# Embedding the app invalidates node.exe's Authenticode signature; an invalid signature looks worse to Windows than none.
[[ "$TARGET" == "win" ]] && python3 "$ROOT/scripts/strip-signature.py" "$OUT"
chmod +x "$OUT"; ls -la "$OUT"
