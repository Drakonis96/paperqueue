// Self-contained DEMO backend. When no real Zotero key is configured the
// server uses this in-memory library so the entire UI works end-to-end — browse,
// queue, reorder, mark read, skip, add by DOI, stats — without any credentials.
// It exposes the same interface as ZoteroClient, so the routes don't care which
// backend is active. Writes mutate in memory and bump a version counter, which
// lets the live (SSE) path light up across browser tabs.

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function dayTag(days) {
  // pq:read:<YYYY-MM-DD> with the date `days` ago (drives stats / streak).
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `pq:read:${d.toISOString().slice(0, 10)}`;
}

/** A compact, realistic sample library. */
function seedItems() {
  let v = 1;
  const item = (key, data) => ({
    key,
    version: v,
    data: { key, version: v++, itemType: "journalArticle", ...data },
  });

  return [
    item("DEMO0001", {
      title: "Attention Is All You Need",
      creators: [
        { creatorType: "author", firstName: "Ashish", lastName: "Vaswani" },
        { creatorType: "author", firstName: "Noam", lastName: "Shazeer" },
        { creatorType: "author", firstName: "Niki", lastName: "Parmar" },
      ],
      publicationTitle: "Advances in Neural Information Processing Systems",
      date: "2017",
      pages: "5998-6008",
      DOI: "10.5555/3295222.3295349",
      tags: [
        { tag: "deep learning" },
        { tag: "transformers" },
        { tag: "pq:queue" },
        { tag: "pq:pos:1024" },
      ],
      dateAdded: isoDaysAgo(40),
      collections: ["COL-ML"],
      contentType: "application/pdf",
    }),
    item("DEMO0002", {
      title: "Deep Residual Learning for Image Recognition",
      creators: [
        { creatorType: "author", firstName: "Kaiming", lastName: "He" },
        { creatorType: "author", firstName: "Xiangyu", lastName: "Zhang" },
      ],
      publicationTitle: "CVPR",
      date: "2016",
      pages: "770-778",
      // Starts in the built-in "Postponed" list to showcase that feature.
      tags: [
        { tag: "computer vision" },
        { tag: "deep learning" },
        { tag: "pq:queue" },
        { tag: "pq:pos:1024" },
        { tag: "pq:qname:Postponed" },
      ],
      dateAdded: isoDaysAgo(38),
      collections: ["COL-ML", "COL-CV"],
    }),
    item("DEMO0003", {
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      creators: [
        { creatorType: "author", firstName: "Jacob", lastName: "Devlin" },
        { creatorType: "author", firstName: "Ming-Wei", lastName: "Chang" },
      ],
      publicationTitle: "NAACL",
      date: "2019",
      pages: "4171-4186",
      tags: [
        { tag: "nlp" },
        { tag: "transformers" },
        { tag: "pq:queue" },
        { tag: "pq:pos:3072" },
      ],
      dateAdded: isoDaysAgo(30),
      collections: ["COL-ML", "COL-NLP"],
    }),
    item("DEMO0004", {
      title: "Generative Adversarial Networks",
      creators: [
        { creatorType: "author", firstName: "Ian", lastName: "Goodfellow" },
        { creatorType: "author", firstName: "Jean", lastName: "Pouget-Abadie" },
      ],
      publicationTitle: "NeurIPS",
      date: "2014",
      pages: "2672-2680",
      tags: [{ tag: "generative models" }, { tag: "pq:queue" }, { tag: "pq:pos:4096" }],
      dateAdded: isoDaysAgo(25),
      collections: ["COL-ML"],
    }),
    item("DEMO0005", {
      title: "Adam: A Method for Stochastic Optimization",
      creators: [
        { creatorType: "author", firstName: "Diederik P.", lastName: "Kingma" },
        { creatorType: "author", firstName: "Jimmy", lastName: "Ba" },
      ],
      publicationTitle: "ICLR",
      date: "2015",
      pages: "1-15",
      tags: [{ tag: "optimization" }, { tag: dayTag(0) }],
      dateAdded: isoDaysAgo(20),
      collections: ["COL-ML"],
    }),
    // A few read papers spread over recent days so Stats / streak show life.
    readItem("DEMO0006", "Dropout: A Simple Way to Prevent Overfitting", "Srivastava", "JMLR", "2014", "1929-1958", 0, ["regularization"], ["COL-ML"]),
    readItem("DEMO0007", "Batch Normalization", "Ioffe", "ICML", "2015", "448-456", 1, ["optimization"], ["COL-ML"]),
    readItem("DEMO0008", "Sequence to Sequence Learning", "Sutskever", "NeurIPS", "2014", "3104-3112", 2, ["nlp"], ["COL-NLP"]),
    readItem("DEMO0009", "Playing Atari with Deep Reinforcement Learning", "Mnih", "NeurIPS Workshop", "2013", "1-9", 3, ["reinforcement learning"], ["COL-RL"]),
    readItem("DEMO0010", "Long Short-Term Memory", "Hochreiter", "Neural Computation", "1997", "1735-1780", 5, ["recurrent networks"], ["COL-NLP"]),
    // Unread, not queued (library only).
    libItem("DEMO0011", "ImageNet Classification with Deep CNNs", "Krizhevsky", "NeurIPS", "2012", "1097-1105", ["computer vision"], ["COL-CV"], 15),
    libItem("DEMO0012", "Mask R-CNN", "He", "ICCV", "2017", "2961-2969", ["computer vision", "segmentation"], ["COL-CV"], 12),
    libItem("DEMO0013", "Word2Vec: Efficient Estimation of Word Representations", "Mikolov", "ICLR", "2013", "1-12", ["nlp", "embeddings"], ["COL-NLP"], 10),
    libItem("DEMO0014", "Proximal Policy Optimization Algorithms", "Schulman", "arXiv", "2017", "1-12", ["reinforcement learning"], ["COL-RL"], 8),
    libItem("DEMO0015", "Denoising Diffusion Probabilistic Models", "Ho", "NeurIPS", "2020", "6840-6851", ["generative models", "diffusion"], ["COL-ML"], 4),
    libItem("DEMO0016", "A Survey of Large Language Models", "Zhao", "arXiv", "2023", "1-97", ["nlp", "survey"], ["COL-NLP"], 2),
  ];

  function readItem(key, title, last, pub, date, pages, daysAgo, tags, cols) {
    return item(key, {
      title,
      creators: [{ creatorType: "author", lastName: last, firstName: "" }],
      publicationTitle: pub,
      date,
      pages,
      tags: [...tags.map((t) => ({ tag: t })), { tag: dayTag(daysAgo) }],
      dateAdded: isoDaysAgo(daysAgo + 20),
      collections: cols,
    });
  }
  function libItem(key, title, last, pub, date, pages, tags, cols, daysAgo) {
    return item(key, {
      title,
      creators: [{ creatorType: "author", lastName: last, firstName: "" }],
      publicationTitle: pub,
      date,
      pages,
      tags: tags.map((t) => ({ tag: t })),
      dateAdded: isoDaysAgo(daysAgo),
      collections: cols,
    });
  }
}

const COLLECTIONS = [
  { key: "COL-ML", name: "Machine Learning", parent: null },
  { key: "COL-CV", name: "Computer Vision", parent: "COL-ML" },
  { key: "COL-NLP", name: "Natural Language", parent: "COL-ML" },
  { key: "COL-RL", name: "Reinforcement Learning", parent: null },
];

export class DemoZoteroClient {
  constructor() {
    this.demo = true;
    this.items = seedItems();
    this.version = 1000;
    this._nextKey = 1000;
    this.onChange = null; // set by the server to broadcast live updates
  }

  _bump() {
    this.version += 1;
    if (this.onChange) this.onChange(this.version);
  }

  async librarySync(since = null) {
    if (since != null && Number(since) === this.version) {
      return { items: [], version: this.version, notModified: true };
    }
    return {
      items: this.items.map((i) => ({ ...i, data: { ...i.data } })),
      version: this.version,
      notModified: false,
    };
  }

  async deletedItemKeys() {
    return [];
  }

  async children() {
    return [];
  }

  async topCollections() {
    return COLLECTIONS.filter((c) => !c.parent).map(({ key, name }) => ({ key, name }));
  }

  async allCollections() {
    return COLLECTIONS.map(({ key, name }) => ({ key, name }));
  }

  async subcollections(key) {
    return COLLECTIONS.filter((c) => c.parent === key).map(({ key, name }) => ({
      key,
      name,
    }));
  }

  async collectionItems(key) {
    return this.items
      .filter((i) => (i.data.collections || []).includes(key))
      .map((i) => ({ ...i, data: { ...i.data } }));
  }

  async createItems(newItems) {
    for (const data of newItems) {
      const key = `NEW${this._nextKey++}`;
      this.items.unshift({
        key,
        version: this.version,
        data: {
          key,
          version: this.version,
          itemType: data.itemType || "journalArticle",
          tags: [],
          dateAdded: new Date().toISOString(),
          collections: [],
          ...data,
        },
      });
    }
    this._bump();
    return { success: {} };
  }

  async setTags(itemKey, tags) {
    const item = this.items.find((i) => i.key === itemKey);
    if (item) {
      item.data.tags = tags.map((t) => ({ tag: t }));
      item.data.version = this.version + 1;
      item.version = this.version + 1;
    }
    this._bump();
  }
}
