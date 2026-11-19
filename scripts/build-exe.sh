#!/usr/bin/env bash
# Builds dist/CareerCopilot.exe: ONE file for Windows. Double-click it; the browser opens.
# It bundles the app, the UI files and its own Node runtime, and carries the app icon.
# Your data is saved in a "data" folder next to the .exe.
# Usage: scripts/build-exe.sh   (needs node 22 matching NODE_VERSION, npm, curl)
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22.23.4}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ "$(node -v)" != "v$NODE_VERSION" ]]; then
  echo "This build needs the local node to be v$NODE_VERSION (the SEA blob must match the Windows node.exe). Found $(node -v)." >&2
  echo "Set NODE_VERSION=$(node -v | sed 's/^v//') to build against that version instead." >&2
  exit 1
fi

echo "Fetching Windows node.exe $NODE_VERSION…"
(cd "$WORK" && npm pack --silent "node-win-x64@$NODE_VERSION" >/dev/null && mkdir nodepkg && tar -xzf "node-win-x64-$NODE_VERSION.tgz" -C nodepkg)
NODE_EXE="$WORK/nodepkg/package/bin/node.exe"
EXPECTED="$(curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | awk '$2=="win-x64/node.exe"{print $1}')"
ACTUAL="$(sha256sum "$NODE_EXE" | awk '{print $1}')"
[[ -n "$EXPECTED" && "$EXPECTED" == "$ACTUAL" ]] || { echo "node.exe checksum mismatch. Aborting." >&2; exit 1; }
echo "node.exe checksum matches nodejs.org."

echo "Installing build tools…"
mkdir -p "$WORK/tools"
(cd "$WORK/tools" && npm init -y >/dev/null && npm i --silent --no-audit --no-fund esbuild postject resedit 2>&1 | tail -2)

echo "Bundling the app into one file…"
(cd "$ROOT" && "$WORK/tools/node_modules/.bin/esbuild" server.js --bundle --platform=node --format=cjs --target=node22 \
  --define:import.meta.url=__importMetaUrl \
  --banner:js='const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' \
  --log-level=warning --outfile="$WORK/app.cjs")

# Every UI file goes inside the exe as an asset.
node --input-type=module - "$ROOT/public" "$WORK" <<'JS'
import fs from "node:fs";
import path from "node:path";
const [pub, work] = process.argv.slice(2);
const assets = {};
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : (assets[`public/${path.relative(pub, p).split(path.sep).join("/")}`] = p); } };
walk(pub);
fs.writeFileSync(path.join(work, "sea-config.json"), JSON.stringify({ main: path.join(work, "app.cjs"), output: path.join(work, "app.blob"), disableExperimentalSEAWarning: true, assets }));
console.log(`${Object.keys(assets).length} UI files embedded`);
JS
node --experimental-sea-config "$WORK/sea-config.json"

cp "$NODE_EXE" "$WORK/CareerCopilot.exe"
echo "Putting the app inside…"
"$WORK/tools/node_modules/.bin/postject" "$WORK/CareerCopilot.exe" NODE_SEA_BLOB "$WORK/app.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

echo "Setting the icon…"
NODE_PATH="$WORK/tools/node_modules" node - "$WORK/CareerCopilot.exe" "$ROOT/public/favicon.ico" "$NODE_VERSION" <<'JS'
const fs = require("node:fs");
const ResEdit = require("resedit");
const [exe, ico, ver] = process.argv.slice(2);
const pe = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(pe);
const icons = ResEdit.Data.IconFile.from(fs.readFileSync(ico)).icons.map((i) => i.data);
// Replace every existing icon group (node's own) with ours, in the same language slot.
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const lang = groups[0]?.lang ?? 1033;
if (groups.length) for (const g of groups) { res.entries = res.entries.filter((e) => !(e.type === 14 && e.id === g.id) && !(e.type === 3)); }
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups[0]?.id ?? 1, lang, icons);
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
if (vi) {
  vi.setStringValues({ lang, codepage: 1200 }, { ProductName: "Career Copilot", FileDescription: "Career Copilot", InternalName: "CareerCopilot", OriginalFilename: "CareerCopilot.exe", CompanyName: "", LegalCopyright: "" });
  vi.outputToResourceEntries(res.entries);
}
res.outputResource(pe);
fs.writeFileSync(exe, Buffer.from(pe.generate()));
JS

mkdir -p "$DIST"
cp "$WORK/CareerCopilot.exe" "$DIST/CareerCopilot.exe"
echo "Built $DIST/CareerCopilot.exe ($(du -h "$DIST/CareerCopilot.exe" | cut -f1))"
