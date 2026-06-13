<p align="center">
  <img src="logo.png" width="120" alt="PaperQueue logo">
</p>

<h1 align="center">PaperQueue</h1>

<p align="center"><i>Read more of your Zotero library, with less friction.</i></p>

PaperQueue turns your [Zotero](https://www.zotero.org) library into a
**focused, curated reading queue**. Zotero is great for organizing references,
but not for the daily flow of *"what do I read today?" → "read it" → "next."*
PaperQueue is built for that.

It comes in **three flavours**, all sharing the same state through Zotero tags,
so a queue you build in one shows up in the others:

- **iOS · iPadOS · macOS** — a native SwiftUI app.
- **Web (self-hosted)** — a single-port web server you run yourself; the same
  features, in any browser. See [`web/`](web/).

> **Serverless by design.** The native app talks **directly** to the Zotero Web
> API (or your local Zotero) — no backend. The web edition is a thin, key-holding
> proxy you self-host. Either way, queue state lives in Zotero **tags**, so it
> syncs across your devices automatically.

## Features

- **Reading queues** — curated lists of papers you actually intend to read.
  Swipe to mark read, postpone, skip, or remove. Drag to reorder (on the web,
  with **touch support** for phones/tablets). Create **multiple named queues**
  (e.g. *To read*, *Teaching*, *Reviews*) and switch between them; the Add button
  targets the **Default** queue unless you pick one. Searching a queue keeps each
  paper's real position number, and sending a read paper back from History
  restores its original slot.
- **Library** — browse your **whole bibliography** (books, chapters, theses,
  reports, conference papers — every Zotero item type, not just journal
  articles), with **search**, **sorting** (recently added, title, author or
  year), and rich **filters**: status (All / In Queue / Unread / Read),
  collection, and searchable **author / tag / publication-year** filters. The
  library is fetched in parallel so large collections load fast. Queued papers
  show a green check.
- **Collections** — navigate collections and subcollections and add papers to
  the queue from there.
- **Live sync progress** — a progress bar while your library is fetched.
- **Add by DOI** — fetches metadata from Crossref and adds the paper to Zotero.
- **History** — everything you've read, with real read dates.
- **Stats** — reading streak, papers read per week, totals, a month calendar
  (over-goal days marked), and a **weekly comeback** indicator that shows when a
  strong day has made up for an earlier day you fell short of your goal.
- **Widget** — pending count and the next paper, one tap to open.
- **Offline-first** — a local SwiftData cache + an outbox that syncs tag
  changes back to Zotero when you're online.

The companion split: **iPhone/iPad** manage the queue (mark read, build queues,
search, add). **Mac** is where you read — it opens the PDF in Zotero.

## How state is stored (Zotero tags)

PaperQueue keeps its state in namespaced Zotero tags, so it's portable and
syncs through Zotero itself:

| Tag | Meaning |
| --- | --- |
| `pq:queue` | The paper is in a reading queue |
| `pq:qname:<name>` | Which named queue (absent ⇒ the Default queue) |
| `pq:pos:<n>` | Position in the queue (gapped, so reordering is cheap) |
| `pq:read:<YYYY-MM-DD>` | Read, with the real read date (multi-device stats) |
| `pq:skip` | Skipped |

These are easy to find and remove in Zotero if you ever stop using the app.

## Data sources

- **Web (any device):** sign in with a personal **Zotero API key**
  ([create one here](https://www.zotero.org/settings/keys/new) with library
  read & write). Works anywhere; needs Zotero Web sync enabled for your library
  metadata. Queue/read tags sync across devices.
- **Local (Mac / same network):** *"Use Zotero on this Mac"* reads your local
  Zotero library directly (all files included) and opens PDFs in Zotero.
  Requires Zotero to be open. Zotero's local API is **read-only**, so to keep a
  Mac (local) and an iPhone/iPad (web) in sync, add a Zotero API key under
  **Settings → Cross-device sync**: PaperQueue then *reads* locally but *writes*
  the `pq:` tags through the web API, and Zotero propagates them to your devices.

Your API key is stored only in the device **Keychain** and sent as the
`Zotero-API-Key` header — it is never hardcoded, logged, or placed in URLs.

## Install

### Web (self-hosted)
Run PaperQueue in your browser on any machine. Set the Zotero key via `.env` or
docker-compose.

```bash
cd web
echo "ZOTERO_API_KEY=your_key_here" > .env   # or leave blank for a demo library
docker compose up -d                          # → http://localhost:5954
```

The web edition ships with **no login and no default credentials** — it opens
straight to your library. If you expose it beyond a trusted network you can turn
on an optional, rate-limited shared password (`AUTH_ENABLED=1`); see
[`web/README.md`](web/README.md#optional-login).

Full instructions and configuration in [`web/README.md`](web/README.md).

### macOS (`PaperQueue.dmg`)
Download from [Releases](https://github.com/Drakonis96/paperqueue/releases),
open the DMG and drag PaperQueue to Applications. The build is **unsigned**, so
the first launch: **right-click → Open**.

### iOS/iPadOS (`PaperQueue-unsigned.ipa`)
The IPA is **unsigned** (a device-installable IPA needs Apple Developer
signing). Two options:
- **AltStore / SideStore** — add the source and install (re-signs with your
  Apple ID):
  ```
  https://raw.githubusercontent.com/Drakonis96/paperqueue/main/altstore-source.json
  ```
- **Xcode** — open the project, set your Team under *Signing & Capabilities*,
  and Run on your connected device.

## Build from source

Requirements: macOS with **Xcode 26+**, [XcodeGen](https://github.com/yonghuang/XcodeGen)
(`brew install xcodegen`).

```bash
cd app
xcodegen generate            # creates PaperQueue.xcodeproj from project.yml
open PaperQueue.xcodeproj     # or build from the command line:

# iOS Simulator
xcodebuild -project PaperQueue.xcodeproj -scheme PaperQueue \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build

# macOS
xcodebuild -project PaperQueue.xcodeproj -scheme PaperQueue \
  -destination 'platform=macOS' build
```

The Xcode project is generated from `app/project.yml` (not committed) — edit
the YAML and re-run `xcodegen generate`.

## Project structure

```
PaperQueue/
├── app/                       # SwiftUI app (iOS + macOS) — the native product
│   ├── project.yml            # XcodeGen project definition
│   ├── PaperQueue/            # app sources (App, Auth, Networking, Persistence, Features…)
│   ├── PaperQueueWidget/      # WidgetKit extension
│   └── Shared/                # code shared with the widget (App Group snapshot)
├── web/                       # self-hosted web edition (Node + browser)
│   ├── src/                   # Express service: static UI + Zotero proxy + live SSE
│   ├── public/                # the browser app (vanilla JS, no build step)
│   └── docker-compose.yml
├── server/                    # legacy Fastify+SQLite backend — NOT used (superseded by web/)
├── altstore-source.json       # AltStore/SideStore source
└── logo.png
```

> `server/` was an earlier OAuth-broker design, kept only for reference. The
> self-hosted web client now lives in [`web/`](web/).

## License

MIT — see [LICENSE](LICENSE).
