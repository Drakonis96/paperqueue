// Optional basic local authentication for the web edition.
//
// Disabled by default (AUTH_ENABLED=0): out of the box PaperQueue requires no
// credentials. When enabled it gates the data API behind a single shared
// username/password (defaults admin / paperqueue, meant to be overridden),
// issuing an HttpOnly session cookie on success. Login attempts are rate-limited
// per client IP to blunt brute-force guessing.
//
// Sessions and the rate-limit ledger live in memory only — small, no dependency,
// and cleared on restart (which simply asks everyone to sign in again).

import crypto from "node:crypto";

import { config } from "./config.js";

const SESSION_TTL_MS = config.auth.sessionHours * 3600 * 1000;
const WINDOW_MS = config.auth.windowMinutes * 60 * 1000;
const BLOCK_MS = config.auth.blockMinutes * 60 * 1000;
const MAX_ATTEMPTS = config.auth.maxAttempts;

const sessions = new Map(); // token -> expiresAt (ms)
const attempts = new Map(); // ip -> { count, firstAt, blockedUntil }

export const COOKIE_NAME = "pq_session";

export function authEnabled() {
  return config.auth.enabled;
}

export function sessionMaxAgeMs() {
  return SESSION_TTL_MS;
}

export function cookieSecure() {
  return config.auth.cookieSecure;
}

// -- Sessions ----------------------------------------------------------------

function pruneSessions() {
  const now = Date.now();
  for (const [token, exp] of sessions) {
    if (exp <= now) sessions.delete(token);
  }
}

export function createSession() {
  pruneSessions();
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function validSession(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token) {
  if (token) sessions.delete(token);
}

// -- Credentials -------------------------------------------------------------

/** Length-safe, constant-time-ish string comparison. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function checkCredentials(username, password) {
  // Compare both fields regardless of the first result so timing doesn't leak
  // which one was wrong.
  const okUser = safeEqual(username, config.auth.username);
  const okPass = safeEqual(password, config.auth.password);
  return okUser && okPass;
}

// -- Rate limiting -----------------------------------------------------------

/** Current limiter state for an IP without recording anything. */
export function rateState(ip) {
  const a = attempts.get(ip);
  const now = Date.now();
  if (!a) return { blocked: false, remaining: MAX_ATTEMPTS, retryAfter: 0 };
  if (a.blockedUntil && a.blockedUntil > now) {
    return { blocked: true, remaining: 0, retryAfter: Math.ceil((a.blockedUntil - now) / 1000) };
  }
  // The counting window has elapsed → effectively a clean slate.
  if (a.firstAt && now - a.firstAt > WINDOW_MS) {
    return { blocked: false, remaining: MAX_ATTEMPTS, retryAfter: 0 };
  }
  return { blocked: false, remaining: Math.max(0, MAX_ATTEMPTS - a.count), retryAfter: 0 };
}

export function recordFailure(ip) {
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || (a.firstAt && now - a.firstAt > WINDOW_MS)) {
    a = { count: 0, firstAt: now, blockedUntil: 0 };
  }
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) a.blockedUntil = now + BLOCK_MS;
  attempts.set(ip, a);
  return rateState(ip);
}

export function recordSuccess(ip) {
  attempts.delete(ip);
}

// -- Cookie parsing ----------------------------------------------------------

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
