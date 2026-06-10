# PaperQueue — App (iOS · iPadOS · macOS)

Multiplatform SwiftUI client. Built with Xcode 26 / Swift 6.2 toolchain.

**Serverless:** the app talks directly to the Zotero Web API with a personal
API key. There is no backend to run. (The `../server` folder is kept for a
possible future web/multi-user client but is not used.)

## Requirements

- macOS with Xcode 26+
- [XcodeGen](https://github.com/yonghuang/XcodeGen) (`brew install xcodegen`)
- A Zotero account

## Generate & open

```bash
cd app
xcodegen generate          # creates PaperQueue.xcodeproj from project.yml
open PaperQueue.xcodeproj
```

The Xcode project is generated, not committed — edit `project.yml` and re-run
`xcodegen generate` to change targets/settings.

## Build from the command line

```bash
# iOS Simulator
xcodebuild -project PaperQueue.xcodeproj -scheme PaperQueue \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build

# macOS
xcodebuild -project PaperQueue.xcodeproj -scheme PaperQueue \
  -destination 'platform=macOS' build
```

> To run on a real device you must set a Development Team and App Group in the
> target's Signing & Capabilities (the App Group `group.com.paperqueue.shared`
> backs the widget).

## Signing in

1. Launch the app.
2. Tap **Open Zotero key settings**, create a private key with **library read &
   write** access, copy it.
3. Paste the key and tap **Connect**.
4. In the queue, tap the sync button (↻) to pull your library from Zotero.

The key is validated against Zotero and stored in the device Keychain. Your
reading stats live locally on the device. Sign out anytime from **Settings**.

## Targets

| Target            | Type          | Notes                                  |
| ----------------- | ------------- | -------------------------------------- |
| PaperQueue        | application   | iOS + macOS (multiplatform)            |
| PaperQueueWidget  | app-extension | Home-screen widget (shared App Group)  |

## Structure

```
app/
├── project.yml                 # XcodeGen project definition
├── Shared/WidgetShared.swift   # snapshot model shared with the widget
├── PaperQueue/
│   ├── App/                    # @main, routing, root view
│   ├── Auth/                   # API-key sign-in, Keychain
│   ├── Networking/             # ZoteroAPI (direct), errors
│   ├── Persistence/            # SwiftData cache + offline outbox
│   ├── Features/Queue|Reader|Stats|Settings
│   └── Design/Theme.swift
└── PaperQueueWidget/           # WidgetKit extension
```
