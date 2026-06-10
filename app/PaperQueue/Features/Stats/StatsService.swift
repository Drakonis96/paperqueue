import Foundation

struct WeekBucket: Identifiable {
    let weekStart: String
    let papersRead: Int
    var id: String { weekStart }
}

struct LocalStats {
    var papersReadTotal: Int
    var pendingCount: Int
    var totalReadingSeconds: Int
    var sessionsCount: Int
    var currentStreakDays: Int
    var perWeek: [WeekBucket]
}

/// Computes reading statistics from the local cache — no server involved.
enum StatsService {
    private static var calendar: Calendar {
        var c = Calendar(identifier: .iso8601)
        c.firstWeekday = 2 // Monday
        return c
    }

    private static func dayKey(_ date: Date) -> String {
        let c = calendar
        let comps = c.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d",
                      comps.year ?? 0, comps.month ?? 0, comps.day ?? 0)
    }

    private static func weekStart(_ date: Date) -> Date {
        let c = calendar
        return c.dateInterval(of: .weekOfYear, for: date)?.start ?? date
    }

    static func compute(
        papers: [CachedPaper],
        sessions: [ReadingSessionLocal],
        now: Date = Date(),
        weeks: Int = 8
    ) -> LocalStats {
        let read = papers.filter { $0.readStatus == "read" }
        let pending = papers.filter { $0.isPending }

        let totalReadingSeconds = sessions.reduce(0) { $0 + $1.durationSeconds }

        // Active days = a session started OR a paper was read (real read date).
        var activeDays = Set<String>()
        for s in sessions { activeDays.insert(dayKey(s.startedAt)) }
        for p in read { activeDays.insert(dayKey(p.readDate ?? p.updatedAt)) }

        // Streak ending today (or yesterday).
        let c = calendar
        var streak = 0
        var cursor = c.startOfDay(for: now)
        if !activeDays.contains(dayKey(cursor)) {
            cursor = c.date(byAdding: .day, value: -1, to: cursor) ?? cursor
        }
        while activeDays.contains(dayKey(cursor)) {
            streak += 1
            cursor = c.date(byAdding: .day, value: -1, to: cursor) ?? cursor
        }

        // Per-week papers-read counts for the last `weeks` weeks.
        var buckets: [String: Int] = [:]
        var order: [String] = []
        var weekCursor = weekStart(now)
        for _ in 0..<weeks {
            let key = dayKey(weekCursor)
            buckets[key] = 0
            order.append(key)
            weekCursor = c.date(byAdding: .day, value: -7, to: weekCursor)
                ?? weekCursor
        }
        for p in read {
            let key = dayKey(weekStart(p.readDate ?? p.updatedAt))
            if buckets[key] != nil { buckets[key, default: 0] += 1 }
        }
        let perWeek = order.sorted().map {
            WeekBucket(weekStart: $0, papersRead: buckets[$0] ?? 0)
        }

        return LocalStats(
            papersReadTotal: read.count,
            pendingCount: pending.count,
            totalReadingSeconds: totalReadingSeconds,
            sessionsCount: sessions.count,
            currentStreakDays: streak,
            perWeek: perWeek)
    }
}
