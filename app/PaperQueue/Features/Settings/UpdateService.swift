#if os(macOS)
import AppKit
import Foundation

/// A GitHub release with the macOS disk image, if present.
struct AppRelease: Equatable {
    let version: String
    let tagName: String
    let notes: String
    let dmgURL: URL?
}

enum UpdateService {
    static let repo = "Drakonis96/paperqueue"

    static var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }

    /// Fetches the latest published release from GitHub.
    static func fetchLatest() async throws -> AppRelease {
        let url = URL(string:
            "https://api.github.com/repos/\(repo)/releases/latest")!
        var req = URLRequest(url: url)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            throw NSError(domain: "PaperQueue.Update", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "GitHub didn't return a release."])
        }
        struct Asset: Decodable { let name: String; let browser_download_url: String }
        struct Release: Decodable {
            let tag_name: String
            let body: String?
            let assets: [Asset]
        }
        let r = try JSONDecoder().decode(Release.self, from: data)
        let dmg = r.assets.first { $0.name.lowercased().hasSuffix(".dmg") }
        let version = r.tag_name.hasPrefix("v")
            ? String(r.tag_name.dropFirst()) : r.tag_name
        return AppRelease(
            version: version, tagName: r.tag_name, notes: r.body ?? "",
            dmgURL: dmg.flatMap { URL(string: $0.browser_download_url) })
    }

    /// True if `remote` is a higher dotted-numeric version than `local`.
    static func isNewer(_ remote: String, than local: String) -> Bool {
        func parts(_ s: String) -> [Int] {
            s.split(separator: ".").map { Int($0.prefix(while: \.isNumber)) ?? 0 }
        }
        let a = parts(remote), b = parts(local)
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0
            let y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    /// Downloads the DMG into ~/Downloads (visible to Finder / the mounter) and
    /// returns its local URL.
    static func downloadDMG(_ url: URL, version: String) async throws -> URL {
        let (tmp, _) = try await URLSession.shared.download(from: url)
        let dir = FileManager.default.urls(
            for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let dest = dir.appendingPathComponent("PaperQueue-\(version).dmg")
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    /// Single-quote escape for safe shell embedding.
    private static func shq(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// Spawns a detached shell script that waits for this app to quit, mounts the
    /// DMG, replaces the app bundle in place (backing it up first, restoring on
    /// failure), and relaunches the new version. Falls back to just opening the
    /// DMG if anything goes wrong. Throws if the script can't even be launched.
    static func spawnInstaller(dmgPath: String, appPath: String) throws {
        let pid = ProcessInfo.processInfo.processIdentifier
        let script = """
        #!/bin/sh
        DMG=\(shq(dmgPath))
        APP=\(shq(appPath))
        PID=\(pid)
        i=0
        while kill -0 "$PID" 2>/dev/null && [ $i -lt 120 ]; do sleep 0.5; i=$((i+1)); done
        MOUNT=$(mktemp -d /tmp/pqmnt.XXXXXX)
        if ! hdiutil attach "$DMG" -nobrowse -noverify -quiet -mountpoint "$MOUNT"; then
          open "$DMG"; exit 1
        fi
        NEW="$MOUNT/PaperQueue.app"
        if [ ! -d "$NEW" ]; then hdiutil detach "$MOUNT" -quiet; open "$DMG"; exit 1; fi
        BAK="$APP.bak"
        rm -rf "$BAK"
        if [ -d "$APP" ]; then
          mv "$APP" "$BAK" 2>/dev/null || { hdiutil detach "$MOUNT" -quiet; open "$DMG"; exit 1; }
        fi
        if ditto "$NEW" "$APP"; then
          rm -rf "$BAK"
          xattr -dr com.apple.quarantine "$APP" 2>/dev/null
          hdiutil detach "$MOUNT" -quiet
          open "$APP"
        else
          rm -rf "$APP"
          [ -d "$BAK" ] && mv "$BAK" "$APP"
          hdiutil detach "$MOUNT" -quiet
          open "$DMG"
        fi
        """
        let scriptURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("paperqueue-install.sh")
        try script.write(to: scriptURL, atomically: true, encoding: .utf8)

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/sh")
        proc.arguments = [
            "-c", "nohup /bin/sh \(shq(scriptURL.path)) >/dev/null 2>&1 &",
        ]
        try proc.run()
    }
}

/// Drives the "Check for Updates" UI in Settings (macOS only).
@MainActor
final class UpdateModel: ObservableObject {
    enum Phase: Equatable {
        case idle
        case checking
        case upToDate
        case available(AppRelease)
        case downloading
        case installing
        case opened
        case failed(String)
    }

    @Published var phase: Phase = .idle

    func check() async {
        phase = .checking
        do {
            let latest = try await UpdateService.fetchLatest()
            phase = UpdateService.isNewer(
                latest.version, than: UpdateService.currentVersion)
                ? .available(latest) : .upToDate
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// Downloads the DMG, then replaces the app in place and relaunches it. If
    /// the in-place install can't run, opens the DMG for a manual drag-install.
    func installAndRelaunch(_ release: AppRelease) async {
        guard let dmgURL = release.dmgURL else {
            phase = .failed("That release has no macOS disk image.")
            return
        }
        phase = .downloading
        let dmg: URL
        do {
            dmg = try await UpdateService.downloadDMG(
                dmgURL, version: release.version)
        } catch {
            phase = .failed(error.localizedDescription)
            return
        }

        do {
            try UpdateService.spawnInstaller(
                dmgPath: dmg.path, appPath: Bundle.main.bundlePath)
            phase = .installing
            // Give the detached installer a moment to start watching this PID.
            try? await Task.sleep(nanoseconds: 800_000_000)
            NSApplication.shared.terminate(nil)
        } catch {
            // Couldn't launch the installer — fall back to opening the DMG.
            NSWorkspace.shared.open(dmg)
            phase = .opened
        }
    }
}
#endif
