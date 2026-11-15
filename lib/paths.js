// Where the app lives. Normally that's the project folder; inside the single-file Windows executable it's
// the folder holding the .exe, so settings, resumes and the tracker are saved right next to it.
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sea from "node:sea";

export const IS_SEA = typeof sea.isSea === "function" && sea.isSea();
export const APP_DIR = IS_SEA ? path.dirname(process.execPath) : path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Read a UI file embedded in the executable. Returns a Buffer, or null when it isn't there. */
export function embedded(name) {
  if (!IS_SEA) return null;
  try { return Buffer.from(sea.getRawAsset(name)); } catch { return null; }
}
