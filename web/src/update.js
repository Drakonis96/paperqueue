// Update check: compares the running version against the latest GitHub release
// so the UI can surface "a new version is available". The result is cached for a
// few hours so we don't hit GitHub on every page load, and any failure is soft
// (we just report no update rather than breaking the app).

import { config } from "./config.js";

const REPO = (process.env.UPDATE_REPO || "Drakonis96/paperqueue").trim();
const CHECK_DISABLED =
  process.env.UPDATE_CHECK === "0" || process.env.UPDATE_CHECK === "false";
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cache = { at: 0, payload: null };

/** Parses "1.2.3" / "v1.2.3" into comparable numbers; non-numeric parts → 0. */
function parseVersion(v) {
  return String(v || "")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((n) => parseInt(n, 10) || 0);
}

/** True if `latest` is strictly greater than `current` (semver-ish). */
export function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function fetchLatestTag() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "PaperQueue" },
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const json = await res.json();
  return (json.tag_name || json.name || "").replace(/^v/i, "");
}

/**
 * Returns { current, latest, updateAvailable, url }. Cached for TTL_MS; never
 * throws — on error it reports the current version with no update.
 */
export async function checkForUpdate() {
  const current = config.version;
  if (CHECK_DISABLED) {
    return { current, latest: current, updateAvailable: false, url: null };
  }
  if (cache.payload && Date.now() - cache.at < TTL_MS) {
    return cache.payload;
  }
  let payload;
  try {
    const latest = await fetchLatestTag();
    payload = {
      current,
      latest,
      updateAvailable: !!latest && isNewer(latest, current),
      url: `https://github.com/${REPO}/releases/latest`,
    };
  } catch {
    payload = { current, latest: current, updateAvailable: false, url: null };
  }
  cache = { at: Date.now(), payload };
  return payload;
}
