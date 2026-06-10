import fp from "fastify-plugin";
import type {
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";
import type { Account } from "../db/schema.js";
import { accountRepo } from "../repositories/account.repo.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
  }
  interface FastifyRequest {
    account: Account;
  }
}

/**
 * Bearer-token auth for the app → server channel. The token is the
 * `sessionToken` minted during the Zotero OAuth callback.
 */
export default fp(
  async (fastify) => {
    // `request.account` is typed via the module augmentation above and assigned
    // by the `authenticate` hook before any handler reads it.
    fastify.decorate(
      "authenticate",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const header = request.headers.authorization ?? "";
        const token = header.startsWith("Bearer ")
          ? header.slice("Bearer ".length).trim()
          : "";

        if (!token) {
          return reply.unauthorized("Missing bearer token");
        }

        const acc = await accountRepo.getBySessionToken(fastify.db, token);
        if (!acc) {
          return reply.unauthorized("Invalid or expired session");
        }

        request.account = acc;
      },
    );
  },
  { name: "auth", dependencies: ["db"] },
);
