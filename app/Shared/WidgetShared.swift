import Foundation

/// Small snapshot the app writes and the widget reads via the shared App Group.
struct WidgetSnapshot: Codable {
    var pendingCount: Int
    var nextTitle: String?
    var nextAuthors: String?
    var nextPaperKey: String?
    var updatedAt: Date

    static let empty = WidgetSnapshot(
        pendingCount: 0,
        nextTitle: nil,
        nextAuthors: nil,
        nextPaperKey: nil,
        updatedAt: .distantPast
    )
}

/// Reads/writes the widget snapshot in App Group UserDefaults, with a graceful
/// fallback to standard defaults when the App Group is unavailable (e.g. on a
/// simulator build without the entitlement provisioned).
enum WidgetBridge {
    static let appGroupId = "group.com.paperqueue.shared"
    private static let key = "widgetSnapshot"

    private static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroupId) ?? .standard
    }

    static func write(_ snapshot: WidgetSnapshot) {
        if let data = try? JSONEncoder().encode(snapshot) {
            defaults.set(data, forKey: key)
        }
    }

    static func read() -> WidgetSnapshot {
        guard let data = defaults.data(forKey: key),
              let snapshot = try? JSONDecoder().decode(
                  WidgetSnapshot.self, from: data)
        else { return .empty }
        return snapshot
    }

    /// Deep link the widget uses to open the next paper directly.
    static func readerURL(paperKey: String?) -> URL {
        if let paperKey {
            return URL(string: "paperqueue://reader/\(paperKey)")!
        }
        return URL(string: "paperqueue://queue")!
    }
}
