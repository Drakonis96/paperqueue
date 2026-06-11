import Foundation

/// App-wide configuration.
/// - Web mode: talks to api.zotero.org with a personal API key (works anywhere).
/// - Local mode (macOS): talks to Zotero desktop's local API; has all local
///   files and opens PDFs in Zotero.
enum AppConfig {
    static let urlScheme = "paperqueue"
    static let appGroupId = "group.com.paperqueue.shared"

    private static let userIdKey = "zoteroUserId"
    private static let usernameKey = "zoteroUsername"
    private static let dataSourceKey = "dataSource"
    private static let queueNamesKey = "queueNames"
    private static let activeQueueKey = "activeQueue"
    private static let dailyGoalKey = "dailyGoal"
    private static let reminderEnabledKey = "reminderEnabled"
    private static let reminderHourKey = "reminderHour"
    private static let reminderMinuteKey = "reminderMinute"
    private static let readExtraTagsKey = "readExtraTags"
    private static let libraryVersionsKey = "libraryVersions"

    /// Extra Zotero tags the user wants applied automatically whenever a paper
    /// is marked read — added on top of PaperQueue's own `pq:read` tag. Optional.
    static var readExtraTags: [String] {
        get { UserDefaults.standard.stringArray(forKey: readExtraTagsKey) ?? [] }
        set {
            UserDefaults.standard.set(newValue.uniqued(), forKey: readExtraTagsKey)
        }
    }

    // MARK: - Reading goal & reminders (gamification)

    /// Papers the user aims to read per day. Drives the goal ring, streak and
    /// the calendar colouring. Always at least 1.
    static var dailyGoal: Int {
        get {
            let v = UserDefaults.standard.integer(forKey: dailyGoalKey)
            return v > 0 ? v : 1
        }
        set { UserDefaults.standard.set(max(1, newValue), forKey: dailyGoalKey) }
    }

    /// Whether the daily reading reminder notification is scheduled.
    static var reminderEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: reminderEnabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: reminderEnabledKey) }
    }

    /// Hour (0…23) the daily reminder fires. Defaults to 19:00.
    static var reminderHour: Int {
        get { UserDefaults.standard.object(forKey: reminderHourKey) as? Int ?? 19 }
        set { UserDefaults.standard.set(newValue, forKey: reminderHourKey) }
    }

    static var reminderMinute: Int {
        get { UserDefaults.standard.object(forKey: reminderMinuteKey) as? Int ?? 0 }
        set { UserDefaults.standard.set(newValue, forKey: reminderMinuteKey) }
    }

    /// The default queue's display name (stored as a plain `pq:queue` tag, with
    /// no `pq:qname:` tag — so it stays backward-compatible with v1.0 data).
    static let defaultQueueName = "Default"

    /// Names of personalized queues the user has created, persisted so an empty
    /// queue still shows up. The Default queue is always implied and not listed.
    static var customQueueNames: [String] {
        get { UserDefaults.standard.stringArray(forKey: queueNamesKey) ?? [] }
        set {
            UserDefaults.standard.set(
                newValue.uniqued(), forKey: queueNamesKey)
        }
    }

    /// All selectable queues, Default first.
    static var allQueueNames: [String] {
        [defaultQueueName] + customQueueNames
    }

    /// The queue currently shown on the Queue tab.
    static var activeQueueName: String {
        get { UserDefaults.standard.string(forKey: activeQueueKey)
            ?? defaultQueueName }
        set { UserDefaults.standard.set(newValue, forKey: activeQueueKey) }
    }

    static var zoteroUserId: String? {
        get { UserDefaults.standard.string(forKey: userIdKey) }
        set { UserDefaults.standard.set(newValue, forKey: userIdKey) }
    }

    static var zoteroUsername: String? {
        get { UserDefaults.standard.string(forKey: usernameKey) }
        set { UserDefaults.standard.set(newValue, forKey: usernameKey) }
    }

    static var dataSource: ZoteroSource {
        get {
            ZoteroSource(
                rawValue: UserDefaults.standard.string(forKey: dataSourceKey) ?? "")
                ?? .web
        }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: dataSourceKey) }
    }

    // MARK: - Incremental sync state

    /// The library's last-seen `Last-Modified-Version`, keyed by library path so
    /// the web library (`users/<id>`) and the local desktop library (`users/0`)
    /// track independently — switching data source never reuses a stale version.
    /// `nil` means "no baseline yet", which forces a full sync.
    static func libraryVersion(for libraryPath: String) -> Int? {
        let dict = UserDefaults.standard
            .dictionary(forKey: libraryVersionsKey) as? [String: Int]
        return dict?[libraryPath]
    }

    static func setLibraryVersion(_ version: Int?, for libraryPath: String) {
        var dict = (UserDefaults.standard
            .dictionary(forKey: libraryVersionsKey) as? [String: Int]) ?? [:]
        dict[libraryPath] = version
        UserDefaults.standard.set(dict, forKey: libraryVersionsKey)
    }

    /// Drops every stored sync baseline (on sign-out or a cache wipe), so the
    /// next sync rebuilds the cache from a full snapshot.
    static func clearLibraryVersions() {
        UserDefaults.standard.removeObject(forKey: libraryVersionsKey)
    }

    static func clearIdentity() {
        UserDefaults.standard.removeObject(forKey: userIdKey)
        UserDefaults.standard.removeObject(forKey: usernameKey)
        UserDefaults.standard.removeObject(forKey: dataSourceKey)
        UserDefaults.standard.removeObject(forKey: queueNamesKey)
        UserDefaults.standard.removeObject(forKey: activeQueueKey)
        clearLibraryVersions()
    }

    /// Deep link that asks Zotero to open a PDF (or select the item).
    static func zoteroOpenURL(attachmentKey: String?, itemKey: String) -> URL {
        if let attachmentKey {
            return URL(string: "zotero://open-pdf/library/items/\(attachmentKey)")!
        }
        return URL(string: "zotero://select/library/items/\(itemKey)")!
    }
}

extension Array where Element: Hashable {
    /// Order-preserving de-duplication.
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
