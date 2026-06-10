import { createHmac, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { ZOTERO_OAUTH } from "../../constants.js";

/**
 * Minimal OAuth 1.0a (HMAC-SHA1) client, just enough for Zotero's 3-legged
 * flow. Zotero returns an API key as the access token, so we never need to
 * sign normal API requests — only the request/access token exchanges here.
 */

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

type OAuthParams = Record<string, string>;

function baseOAuthParams(): OAuthParams {
  return {
    oauth_consumer_key: env.ZOTERO_CLIENT_KEY ?? "",
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };
}

/** Builds the HMAC-SHA1 signature for a request. */
function sign(
  method: string,
  url: string,
  params: OAuthParams,
  tokenSecret = "",
): string {
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k] ?? "")}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    rfc3986(url),
    rfc3986(paramString),
  ].join("&");

  const signingKey = `${rfc3986(env.ZOTERO_CLIENT_SECRET ?? "")}&${rfc3986(
    tokenSecret,
  )}`;

  return createHmac("sha1", signingKey).update(baseString).digest("base64");
}

/** Builds the `Authorization: OAuth ...` header value. */
function authHeader(params: OAuthParams): string {
  const parts = Object.keys(params)
    .filter((k) => k.startsWith("oauth_"))
    .sort()
    .map((k) => `${rfc3986(k)}="${rfc3986(params[k] ?? "")}"`)
    .join(", ");
  return `OAuth ${parts}`;
}

/** Parses an `application/x-www-form-urlencoded` body into an object. */
function parseForm(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

export type RequestTokenResult = {
  oauthToken: string;
  oauthTokenSecret: string;
};

/**
 * Step 1: obtain a temporary request token, telling Zotero where to send the
 * user back after they authorize.
 */
export async function getRequestToken(
  callbackUrl: string,
): Promise<RequestTokenResult> {
  const params: OAuthParams = {
    ...baseOAuthParams(),
    oauth_callback: callbackUrl,
  };
  params.oauth_signature = sign("POST", ZOTERO_OAUTH.requestToken, params);

  const res = await fetch(ZOTERO_OAUTH.requestToken, {
    method: "POST",
    headers: { Authorization: authHeader(params) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zotero request token failed (${res.status}): ${text}`);
  }
  const parsed = parseForm(text);
  if (!parsed.oauth_token || !parsed.oauth_token_secret) {
    throw new Error(`Malformed request token response: ${text}`);
  }
  return {
    oauthToken: parsed.oauth_token,
    oauthTokenSecret: parsed.oauth_token_secret,
  };
}

/** Builds the URL the user must visit to authorize the app. */
export function buildAuthorizeUrl(oauthToken: string): string {
  const url = new URL(ZOTERO_OAUTH.authorize);
  url.searchParams.set("oauth_token", oauthToken);
  url.searchParams.set("name", "PaperQueue");
  url.searchParams.set("library_access", "1");
  url.searchParams.set("notes_access", "0");
  url.searchParams.set("write_access", "1"); // needed to write _read tags
  url.searchParams.set("all_groups", "read");
  return url.toString();
}

export type AccessTokenResult = {
  /** Zotero API key (oauth_token == oauth_token_secret == the key). */
  apiKey: string;
  userId: string;
  username?: string;
};

/**
 * Step 3: exchange the authorized request token + verifier for the permanent
 * Zotero API key.
 */
export async function getAccessToken(
  oauthToken: string,
  oauthTokenSecret: string,
  oauthVerifier: string,
): Promise<AccessTokenResult> {
  const params: OAuthParams = {
    ...baseOAuthParams(),
    oauth_token: oauthToken,
    oauth_verifier: oauthVerifier,
  };
  params.oauth_signature = sign(
    "POST",
    ZOTERO_OAUTH.accessToken,
    params,
    oauthTokenSecret,
  );

  const res = await fetch(ZOTERO_OAUTH.accessToken, {
    method: "POST",
    headers: { Authorization: authHeader(params) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zotero access token failed (${res.status}): ${text}`);
  }
  const parsed = parseForm(text);
  if (!parsed.oauth_token || !parsed.userID) {
    throw new Error(`Malformed access token response: ${text}`);
  }
  return {
    apiKey: parsed.oauth_token,
    userId: parsed.userID,
    username: parsed.username,
  };
}

/** Generates an opaque bearer token for the app → server channel. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}
