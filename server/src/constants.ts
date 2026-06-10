/** Zotero tag written when a paper is marked read (synced from/to Zotero). */
export const READ_TAG = "_read";
/** Zotero tag written when a paper is skipped. */
export const SKIP_TAG = "_skip";

/** How long a postponed paper stays hidden, in milliseconds (default 1 day). */
export const POSTPONE_MS = 24 * 60 * 60 * 1000;

/** Zotero Web API base URL. */
export const ZOTERO_API_BASE = "https://api.zotero.org";

/** Zotero OAuth 1.0a endpoints. */
export const ZOTERO_OAUTH = {
  requestToken: "https://www.zotero.org/oauth/request",
  authorize: "https://www.zotero.org/oauth/authorize",
  accessToken: "https://www.zotero.org/oauth/access",
} as const;
