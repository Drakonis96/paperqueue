import type { FastifyPluginAsync } from "fastify";
import { env, hasZoteroCredentials } from "../config/env.js";
import { accountRepo } from "../repositories/account.repo.js";
import {
  buildAuthorizeUrl,
  generateSessionToken,
  getAccessToken,
  getRequestToken,
} from "../services/zotero/oauth.js";
import { verifyZoteroKey } from "../services/zotero/client.js";

/**
 * In-memory store mapping a temporary request token to its secret, valid only
 * between /start and /callback. Single-user dev: a Map is plenty. Entries
 * expire after 10 minutes.
 */
const tempSecrets = new Map<string, { secret: string; exp: number }>();
const TEMP_TTL_MS = 10 * 60 * 1000;

function putTemp(token: string, secret: string): void {
  tempSecrets.set(token, { secret, exp: Date.now() + TEMP_TTL_MS });
}
function takeTemp(token: string): string | undefined {
  const entry = tempSecrets.get(token);
  tempSecrets.delete(token);
  if (!entry || entry.exp < Date.now()) return undefined;
  return entry.secret;
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Public: is the server configured, and is an account linked?
  fastify.get("/auth/status", async () => {
    const acc = await accountRepo.get(fastify.db);
    return {
      configured: hasZoteroCredentials,
      linked: Boolean(acc),
      username: acc?.username ?? null,
    };
  });

  // Sign in with a personal Zotero API key (no OAuth app needed). The key is
  // validated against Zotero, stored on the single account row, and exchanged
  // for an app session token. The raw key is never logged.
  fastify.post<{ Body: { apiKey?: string } }>(
    "/auth/zotero/key",
    async (request, reply) => {
      const apiKey = request.body?.apiKey?.trim();
      if (!apiKey) return reply.badRequest("apiKey is required");

      let info;
      try {
        info = await verifyZoteroKey(apiKey);
      } catch (err) {
        request.log.warn(
          { status: (err as Error).message },
          "Zotero key verification failed",
        );
        return reply.unauthorized(
          "That API key was rejected by Zotero. Double-check you copied it correctly.",
        );
      }

      if (!info.canRead) {
        return reply.forbidden(
          "This key has no library read access. Create a key with at least read permission.",
        );
      }

      const sessionToken = generateSessionToken();
      await accountRepo.upsert(fastify.db, {
        zoteroUserId: info.userId,
        username: info.username ?? null,
        apiKey,
        libraryId: `users/${info.userId}`,
        sessionToken,
      });

      return {
        sessionToken,
        username: info.username ?? null,
        canWrite: info.canWrite,
      };
    },
  );

  // Step 1: kick off the OAuth dance. The app opens this URL in a web auth
  // session; we 302 the user to Zotero's authorize page.
  fastify.get("/auth/zotero/start", async (request, reply) => {
    if (!hasZoteroCredentials) {
      return reply.serviceUnavailable(
        "Zotero credentials are not configured on the server.",
      );
    }

    const callbackUrl = `${env.SERVER_PUBLIC_URL}/api/v1/auth/zotero/callback`;
    try {
      const { oauthToken, oauthTokenSecret } =
        await getRequestToken(callbackUrl);
      putTemp(oauthToken, oauthTokenSecret);
      return reply.redirect(buildAuthorizeUrl(oauthToken));
    } catch (err) {
      request.log.error(err, "Zotero request token failed");
      return reply.badGateway("Could not start Zotero authorization.");
    }
  });

  // Step 2: Zotero redirects the user here after they approve.
  fastify.get<{
    Querystring: { oauth_token?: string; oauth_verifier?: string };
  }>("/auth/zotero/callback", async (request, reply) => {
    const { oauth_token, oauth_verifier } = request.query;
    if (!oauth_token || !oauth_verifier) {
      return reply.badRequest("Missing oauth_token or oauth_verifier.");
    }

    const secret = takeTemp(oauth_token);
    if (!secret) {
      return reply.badRequest("Unknown or expired request token.");
    }

    try {
      const { apiKey, userId, username } = await getAccessToken(
        oauth_token,
        secret,
        oauth_verifier,
      );
      const sessionToken = generateSessionToken();

      await accountRepo.upsert(fastify.db, {
        zoteroUserId: userId,
        username: username ?? null,
        apiKey,
        libraryId: `users/${userId}`,
        sessionToken,
      });

      // Hand the session token back to the app via its deep link.
      const target = new URL(env.APP_CALLBACK_URL);
      target.searchParams.set("session", sessionToken);
      if (username) target.searchParams.set("user", username);
      return reply.redirect(target.toString());
    } catch (err) {
      request.log.error(err, "Zotero access token exchange failed");
      const target = new URL(env.APP_CALLBACK_URL);
      target.searchParams.set("error", "exchange_failed");
      return reply.redirect(target.toString());
    }
  });

  // Authenticated: who am I?
  fastify.get(
    "/auth/me",
    { preHandler: [fastify.authenticate] },
    async (request) => ({
      zoteroUserId: request.account.zoteroUserId,
      username: request.account.username,
      libraryId: request.account.libraryId,
    }),
  );

  // Authenticated: unlink the account.
  fastify.post(
    "/auth/logout",
    { preHandler: [fastify.authenticate] },
    async (_request, reply) => {
      await accountRepo.clear(fastify.db);
      return reply.code(204).send();
    },
  );
};

export default authRoutes;
