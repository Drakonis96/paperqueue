// Environment configuration for the PaperQueue web server.
//
// Everything is driven by env vars, so you can set them in a `.env` file, a
// `docker-compose.yml`, or the shell — whichever you prefer. Only the Zotero
// API key is really needed; the user id is resolved automatically from the key.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/// Minimal .env loader (no dependency). Reads KEY=VALUE lines from web/.env if
/// present and copies any that aren't already set in the real environment.
function loadDotEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

// Single source of truth for the version: web/package.json (kept in lockstep
// with the iOS/macOS MARKETING_VERSION so version names match across platforms).
let pkgVersion = "0.0.0";
try {
  pkgVersion = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")
  ).version;
} catch {
  /* keep fallback */
}

const apiKey = (process.env.ZOTERO_API_KEY || "").trim();

export const config = {
  /// App version (matches the native iOS/macOS build).
  version: pkgVersion,

  /// Port the single service listens on. Defaults to 5954.
  port: Number(process.env.PORT || process.env.PAPERQUEUE_PORT || 5954),

  /// Zotero Web API key (create one at
  /// https://www.zotero.org/settings/keys/new with library read & write).
  /// When empty the server boots in a self-contained DEMO mode with a built-in
  /// sample library, so you can try the whole UI before adding a real key.
  zoteroApiKey: apiKey,

  /// Optional explicit user/library id. Normally left blank — it's resolved
  /// from the key on boot. Set ZOTERO_USER_ID to override, or to point at a
  /// group library use e.g. ZOTERO_LIBRARY=groups/123456.
  zoteroUserId: (process.env.ZOTERO_USER_ID || "").trim(),
  zoteroLibrary: (process.env.ZOTERO_LIBRARY || "").trim(),

  /// Base URL for the Zotero API. Override only to point at a self-hosted or
  /// proxied endpoint; the default is the public Zotero Web API.
  zoteroApiBase: (
    process.env.ZOTERO_API_BASE || "https://api.zotero.org"
  ).replace(/\/+$/, ""),

  /// Zotero streaming endpoint (live updates). Override only if proxied.
  zoteroStreamURL: process.env.ZOTERO_STREAM_URL || "wss://stream.zotero.org",

  /// Force demo mode even if a key is present (handy for screenshots / trying).
  demo: process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true",
};

/// True when we have no real credentials (or DEMO_MODE is forced) and should
/// serve the built-in sample library.
export const isDemo = config.demo || config.zoteroApiKey === "";
