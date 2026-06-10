import type { FastifyPluginAsync } from "fastify";
import { papersRepo } from "../repositories/papers.repo.js";
import { ZoteroClient } from "../services/zotero/client.js";

const pdfRoutes: FastifyPluginAsync = async (fastify) => {
  // Proxies the paper's PDF from Zotero so the app never needs the API key.
  fastify.get<{ Params: { paperId: string } }>(
    "/papers/:paperId/pdf",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const paper = await papersRepo.byId(
        fastify.db,
        Number(request.params.paperId),
      );
      if (!paper) return reply.notFound("Paper not found");
      if (!paper.pdfAttachmentKey) {
        return reply.notFound("This paper has no PDF attachment");
      }

      try {
        const client = new ZoteroClient(
          request.account.apiKey,
          request.account.zoteroUserId,
        );
        const { bytes, contentType } = await client.downloadFile(
          paper.pdfAttachmentKey,
        );
        return reply
          .header("Content-Type", contentType)
          .header(
            "Content-Disposition",
            `inline; filename="${paper.zoteroKey}.pdf"`,
          )
          .send(Buffer.from(bytes));
      } catch (err) {
        request.log.error(err, "PDF download failed");
        return reply.badGateway("Could not fetch the PDF from Zotero.");
      }
    },
  );
};

export default pdfRoutes;
