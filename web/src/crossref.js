// Looks up paper metadata by DOI via the free Crossref API and maps it to a
// Zotero item-data object ready to POST. Mirrors the app's CrossrefClient.

const BASE = "https://api.crossref.org/works/";

export async function zoteroItemForDOI(rawDOI) {
  const doi = String(rawDOI || "")
    .trim()
    .replace("https://doi.org/", "")
    .replace(/^doi:/i, "");
  if (!doi) {
    const err = new Error("Enter a valid DOI.");
    err.status = 400;
    throw err;
  }

  const res = await fetch(BASE + encodeURIComponent(doi), {
    headers: { "User-Agent": "PaperQueue-Web/1.0 (mailto:app@paperqueue.local)" },
  });
  if (res.status !== 200) {
    const err = new Error("No metadata found for that DOI.");
    err.status = res.status;
    throw err;
  }
  const root = await res.json().catch(() => null);
  const m = root?.message;
  if (!m) {
    const err = new Error("Unexpected Crossref response.");
    err.status = 502;
    throw err;
  }
  return mapToZotero(m, doi);
}

function mapToZotero(m, doi) {
  const item = { itemType: "journalArticle", DOI: doi };

  const title = Array.isArray(m.title) ? m.title[0] : undefined;
  if (title) item.title = title;
  const container = Array.isArray(m["container-title"])
    ? m["container-title"][0]
    : undefined;
  if (container) item.publicationTitle = container;
  if (m.URL) item.url = m.URL;
  if (m.abstract) item.abstractNote = stripHTML(m.abstract);

  if (Array.isArray(m.author)) {
    item.creators = m.author.map((a) => ({
      creatorType: "author",
      firstName: a.given || "",
      lastName: a.family || "",
    }));
  }

  const parts = m.issued?.["date-parts"]?.[0];
  if (Array.isArray(parts)) item.date = parts.join("-");

  return item;
}

function stripHTML(s) {
  return s.replace(/<[^>]+>/g, "");
}
