import Foundation

/// Small snapshot the app writes and the widget reads via the shared App Group.
struct WidgetSnapshot: Codable {
    var pendingCount: Int
    var nextTitle: String?
    var nextAuthors: String?
    var nextPaperKey: String?
    var updatedAt: Date
    // Gamification fields (added in 1.3.0). Decoded defensively so snapshots
    // written by older builds still load.
    var streakDays: Int
    var readToday: Int
    var dailyGoal: Int

    init(
        pendingCount: Int,
        nextTitle: String?,
        nextAuthors: String?,
        nextPaperKey: String?,
        updatedAt: Date,
        streakDays: Int = 0,
        readToday: Int = 0,
        dailyGoal: Int = 1
    ) {
        self.pendingCount = pendingCount
        self.nextTitle = nextTitle
        self.nextAuthors = nextAuthors
        self.nextPaperKey = nextPaperKey
        self.updatedAt = updatedAt
        self.streakDays = streakDays
        self.readToday = readToday
        self.dailyGoal = dailyGoal
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pendingCount = try c.decode(Int.self, forKey: .pendingCount)
        nextTitle = try c.decodeIfPresent(String.self, forKey: .nextTitle)
        nextAuthors = try c.decodeIfPresent(String.self, forKey: .nextAuthors)
        nextPaperKey = try c.decodeIfPresent(String.self, forKey: .nextPaperKey)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
        streakDays = try c.decodeIfPresent(Int.self, forKey: .streakDays) ?? 0
        readToday = try c.decodeIfPresent(Int.self, forKey: .readToday) ?? 0
        dailyGoal = try c.decodeIfPresent(Int.self, forKey: .dailyGoal) ?? 1
    }

    var goalMetToday: Bool { readToday >= dailyGoal }

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
