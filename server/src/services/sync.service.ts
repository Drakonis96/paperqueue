import type { DB } from "../db/client.js";
import type { Account, Creator, ReadStatus } from "../db/schema.js";
import { READ_TAG, SKIP_TAG } from "../constants.js";
import { papersRepo } from "../repositories/papers.repo.js";
import { queueRepo } from "../repositories/queue.repo.js";
import { ZoteroClient, type ZoteroItem } from "./zotero/client.js";

export type SyncResult = {
  fetched: number;
  papers: number;
  pdfs: number;
};

const NON_PAPER_TYPES = new Set(["attachment", "note", "annotation"]);

function readStatusFromTags(tags: string[]): ReadStatus {
  if (tags.includes(READ_TAG)) return "read";
  if (tags.includes(SKIP_TAG)) return "skipped";
  return "unread";
}

/**
 * Pulls the user's whole library from Zotero and reconciles it into the local
 * `papers` and `queue` tables. Idempotent: safe to run repeatedly.
 */
export async function syncLibrary(
  db: DB,
  acc: Account,
): Promise<SyncResult> {
  const client = new ZoteroClient(acc.apiKey, acc.zoteroUserId);
  const items = await client.getAllItems();

  // Map each parent item key -> its first PDF attachment key.
  const pdfByParent = new Map<string, string>();
  for (const item of items) {
    const d = item.data;
    if (
      d.itemType === "attachment" &&
      d.contentType === "application/pdf" &&
      d.parentItem
    ) {
      if (!pdfByParent.has(d.parentItem)) {
        pdfByParent.set(d.parentItem, d.key);
      }
    }
  }

  const tops = items.filter(
    (i) => !NON_PAPER_TYPES.has(i.data.itemType) && !i.data.parentItem,
  );

  let pdfs = 0;
  for (const item of tops) {
    const d = item.data;
    const tags = (d.tags ?? []).map((t) => t.tag);
    const readStatus = readStatusFromTags(tags);
    const pdfAttachmentKey = pdfByParent.get(d.key) ?? null;
    if (pdfAttachmentKey) pdfs++;

    const paperId = await papersRepo.upsert(db, {
      zoteroKey: d.key,
      zoteroVersion: d.version,
      libraryId: acc.libraryId,
      itemType: d.itemType,
      title: d.title ?? "(untitled)",
      creators: (d.creators ?? []) as Creator[],
      abstract: d.abstractNote ?? null,
      publicationTitle: d.publicationTitle ?? null,
      publicationDate: d.date ?? null,
      doi: d.DOI ?? null,
      url: d.url ?? null,
      tags,
      pdfAttachmentKey,
      readStatus,
      zoteroDateAdded: d.dateAdded ?? null,
    });

    // Keep the queue in sync with read state.
    if (readStatus === "read") {
      await queueRepo.ensure(db, paperId);
      await queueRepo.setStatus(db, paperId, "done", {
        completedAt: new Date(),
      });
    } else if (readStatus === "skipped") {
      await queueRepo.ensure(db, paperId);
      await queueRepo.setStatus(db, paperId, "done");
    } else {
      await queueRepo.ensure(db, paperId);
    }
  }

  return { fetched: items.length, papers: tops.length, pdfs };
}

/** Re-exported for callers that need ad-hoc Zotero access. */
export { ZoteroClient };
export type { ZoteroItem };
