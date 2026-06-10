import { ZOTERO_API_BASE } from "../../constants.js";

export type ZoteroKeyInfo = {
  userId: string;
  username?: string;
  /** Whether the key can read the personal library. */
  canRead: boolean;
  /** Whether the key can write (needed for _read tags). */
  canWrite: boolean;
};

/**
 * Validates a personal Zotero API key by calling `/keys/current`, returning the
 * owning user and its access level. Throws if the key is rejected.
 */
export async function verifyZoteroKey(apiKey: string): Promise<ZoteroKeyInfo> {
  const res = await fetch(`${ZOTERO_API_BASE}/keys/current`, {
    headers: {
      "Zotero-API-Version": "3",
      "Zotero-API-Key": apiKey,
    },
  });
  if (!res.ok) {
    throw new Error(`Zotero rejected the API key (${res.status})`);
  }
  const data = (await res.json()) as {
    userID: number;
    username?: string;
    access?: { user?: { library?: boolean; write?: boolean } };
  };
  return {
    userId: String(data.userID),
    username: data.username,
    canRead: data.access?.user?.library ?? false,
    canWrite: data.access?.user?.write ?? false,
  };
}

/**
 * Thin wrapper over the Zotero Web API v3. Authenticated with the user's API key
 * (passed as the `Zotero-API-Key` header).
 */

export type ZoteroCreator = {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
};

export type ZoteroTag = { tag: string; type?: number };

export type ZoteroItemData = {
  key: string;
  version: number;
  itemType: string;
  title?: string;
  creators?: ZoteroCreator[];
  abstractNote?: string;
  publicationTitle?: string;
  date?: string;
  DOI?: string;
  url?: string;
  tags?: ZoteroTag[];
  dateAdded?: string;
  parentItem?: string;
  contentType?: string;
  linkMode?: string;
  filename?: string;
};

export type ZoteroItem = {
  key: string;
  version: number;
  library: { type: string; id: number };
  data: ZoteroItemData;
};

export class ZoteroClient {
  constructor(
    private readonly apiKey: string,
    private readonly userId: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "Zotero-API-Version": "3",
      "Zotero-API-Key": this.apiKey,
      ...extra,
    };
  }

  private userPath(suffix: string): string {
    return `${ZOTERO_API_BASE}/users/${this.userId}${suffix}`;
  }

  /**
   * Fetches ALL items (top-level + attachments/notes), following pagination.
   * We pull everything so we can link PDF attachments to their parents locally
   * instead of issuing a /children request per paper.
   */
  async getAllItems(): Promise<ZoteroItem[]> {
    const all: ZoteroItem[] = [];
    const limit = 100;
    let start = 0;

    for (;;) {
      const url = this.userPath(
        `/items?include=data&limit=${limit}&start=${start}`,
      );
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) {
        throw new Error(
          `Zotero getAllItems failed (${res.status}): ${await res.text()}`,
        );
      }
      const batch = (await res.json()) as ZoteroItem[];
      all.push(...batch);

      const total = Number(res.headers.get("Total-Results") ?? all.length);
      start += limit;
      if (start >= total || batch.length === 0) break;
    }

    return all;
  }

  /** Reads a single item (used to get its current version before a PATCH). */
  async getItem(itemKey: string): Promise<ZoteroItem> {
    const res = await fetch(this.userPath(`/items/${itemKey}`), {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(
        `Zotero getItem ${itemKey} failed (${res.status}): ${await res.text()}`,
      );
    }
    return (await res.json()) as ZoteroItem;
  }

  /**
   * Replaces an item's tags. Reads the current version first, then PATCHes only
   * the `tags` field with the required `If-Unmodified-Since-Version` header.
   * Returns the new item version.
   */
  async setTags(itemKey: string, tags: string[]): Promise<number> {
    const current = await this.getItem(itemKey);
    const version = current.data.version;

    const res = await fetch(this.userPath(`/items/${itemKey}`), {
      method: "PATCH",
      headers: this.headers({
        "Content-Type": "application/json",
        "If-Unmodified-Since-Version": String(version),
      }),
      body: JSON.stringify({ tags: tags.map((t) => ({ tag: t })) }),
    });

    if (res.status !== 204) {
      throw new Error(
        `Zotero setTags ${itemKey} failed (${res.status}): ${await res.text()}`,
      );
    }
    return Number(res.headers.get("Last-Modified-Version") ?? version + 1);
  }

  /** Downloads the raw bytes of an attachment file (e.g. a PDF). */
  async downloadFile(
    itemKey: string,
  ): Promise<{ bytes: ArrayBuffer; contentType: string }> {
    const res = await fetch(this.userPath(`/items/${itemKey}/file`), {
      headers: this.headers(),
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(
        `Zotero downloadFile ${itemKey} failed (${res.status})`,
      );
    }
    return {
      bytes: await res.arrayBuffer(),
      contentType:
        res.headers.get("Content-Type") ?? "application/octet-stream",
    };
  }
}
