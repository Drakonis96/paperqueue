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

    static func clearIdentity() {
        UserDefaults.standard.removeObject(forKey: userIdKey)
        UserDefaults.standard.removeObject(forKey: usernameKey)
        UserDefaults.standard.removeObject(forKey: dataSourceKey)
    }

    /// Deep link that asks Zotero to open a PDF (or select the item).
    static func zoteroOpenURL(attachmentKey: String?, itemKey: String) -> URL {
        if let attachmentKey {
            return URL(string: "zotero://open-pdf/library/items/\(attachmentKey)")!
        }
        return URL(string: "zotero://select/library/items/\(itemKey)")!
    }
}
