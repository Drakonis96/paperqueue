// Server-side persistence for user settings (daily goal, custom queues, tags on
// read, AI favourites…). These aren't part of Zotero's tag state, so without
// this they'd live only in one browser's localStorage and never follow you to
// another device. Here they're written to a small JSON file under DATA_DIR
// (mount a volume at it so they survive container restarts), making the server
// the shared source of truth across every browser that talks to it.

import fs from "node:fs";
import path from "node:path";

import { config } from "./config.js";

const SETTINGS_FILE = "settings.json";

function settingsPath() {
  return path.join(config.dataDir, SETTINGS_FILE);
}

/** Reads the stored settings object, or {} if none has been saved yet. */
export function readSettings() {
  try {
    const json = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return json && typeof json === "object" && !Array.isArray(json) ? json : {};
  } catch {
    return {}; // no file yet, or unreadable — caller treats {} as "empty"
  }
}

/** Atomically writes the settings object (creates DATA_DIR if needed). */
export function writeSettings(obj) {
  const data = obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  fs.mkdirSync(config.dataDir, { recursive: true });
  const target = settingsPath();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
}
