import type { Paper, QueueEntry, ReadingSession } from "./db/schema.js";

/** Shape sent to the app for a paper (optionally with its queue state). */
export type PaperDTO = {
  id: number;
  zoteroKey: string;
  title: string;
  authors: string[];
  publicationTitle: string | null;
  date: string | null;
  doi: string | null;
  url: string | null;
  tags: string[];
  hasPdf: boolean;
  readStatus: Paper["readStatus"];
  queueStatus: QueueEntry["status"] | null;
  addedAt: string | null;
};

function authorNames(creators: Paper["creators"]): string[] {
  return creators.map((c) => {
    if (c.name) return c.name;
    if (c.lastName && c.firstName) return `${c.lastName}, ${c.firstName}`;
    return c.lastName ?? c.firstName ?? "";
  });
}

export function paperToDTO(
  paper: Paper,
  queueEntry?: QueueEntry | null,
): PaperDTO {
  return {
    id: paper.id,
    zoteroKey: paper.zoteroKey,
    title: paper.title,
    authors: authorNames(paper.creators),
    publicationTitle: paper.publicationTitle,
    date: paper.publicationDate,
    doi: paper.doi,
    url: paper.url,
    tags: paper.tags,
    hasPdf: Boolean(paper.pdfAttachmentKey),
    readStatus: paper.readStatus,
    queueStatus: queueEntry?.status ?? null,
    addedAt: paper.zoteroDateAdded ?? paper.createdAt.toISOString(),
  };
}

export type SessionDTO = {
  id: number;
  paperId: number;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  lastPage: number | null;
  totalPages: number | null;
};

export function sessionToDTO(s: ReadingSession): SessionDTO {
  return {
    id: s.id,
    paperId: s.paperId,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    durationSeconds: s.durationSeconds,
    lastPage: s.lastPage,
    totalPages: s.totalPages,
  };
}
