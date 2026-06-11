import Foundation

struct WeekBucket: Identifiable {
    let weekStart: String
    let papersRead: Int
    var id: String { weekStart }
}

/// How a calendar day reads against the user's goal.
enum DayStatus {
    case future      // hasn't happened yet
    case untracked   // before any reading was logged — no judgement
    case today       // today, goal not yet met (in progress)
    case met         // read >= daily goal
    case partial     // read at least one, but below goal
    case missed      // a tracked past day with no reading
}

struct LocalStats {
    var dailyGoal: Int
    var readToday: Int
    var readThisWeek: Int
    var readThisMonth: Int
    var papersReadTotal: Int
    var pendingCount: Int
    var libraryCount: Int
    var currentStreakDays: Int
    var longestStreakDays: Int
    var bestDayCount: Int
    var activeDaysCount: Int
    var averagePerActiveDay: Double
    var perWeek: [WeekBucket]
    /// dayKey ("yyyy-MM-dd") -> papers read that day. Drives the calendar.
    var countsByDay: [String: Int]
    var firstActiveDay: Date?

    var goalMetToday: Bool { readToday >= dailyGoal }
    /// 0…1 progress toward today's goal.
    var todayProgress: Double {
        guard dailyGoal > 0 else { return 1 }
        return min(Double(readToday) / Double(dailyGoal), 1)
    }
}

/// Computes reading statistics from the local cache — no server involved.
enum StatsService {
    static var calendar: Calendar {
        var c = Calendar(identifier: .iso8601)
        c.firstWeekday = 2 // Monday
        return c
    }

    static func dayKey(_ date: Date) -> String {
        let comps = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d",
                      comps.year ?? 0, comps.month ?? 0, comps.day ?? 0)
    }

    private static func weekStart(_ date: Date) -> Date {
        calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? date
    }

    static func compute(
        papers: [CachedPaper],
        sessions: [ReadingSessionLocal],
        goal: Int = AppConfig.dailyGoal,
        now: Date = Date(),
        weeks: Int = 8
    ) -> LocalStats {
        let c = calendar
        let read = papers.filter { $0.readStatus == "read" }
        let pending = papers.filter { $0.isPending }

        // Papers read per calendar day (the unit everything gamified counts).
        var counts: [String: Int] = [:]
        for p in read {
            let day = p.readDate ?? p.updatedAt
            counts[dayKey(day), default: 0] += 1
        }

        let todayKey = dayKey(now)
        let readToday = counts[todayKey] ?? 0

        // This week / month windows.
        let weekStartDate = weekStart(now)
        let monthStart = c.dateInterval(of: .month, for: now)?.start ?? now
        var readThisWeek = 0
        var readThisMonth = 0
        for p in read {
            let day = c.startOfDay(for: p.readDate ?? p.updatedAt)
            if day >= weekStartDate { readThisWeek += 1 }
            if day >= monthStart { readThisMonth += 1 }
        }

        // Earliest day with any reading (anchors the calendar's "tracked" range).
        let firstActiveDay = read
            .map { c.startOfDay(for: $0.readDate ?? $0.updatedAt) }
            .min()

        // Current streak: consecutive days (ending today or yesterday) that met
        // the goal. Today not meeting the goal doesn't break a streak that ran
        // up to yesterday — the day isn't over yet.
        func met(_ day: Date) -> Bool { (counts[dayKey(day)] ?? 0) >= goal }
        var currentStreak = 0
        var cursor = c.startOfDay(for: now)
        if !met(cursor) {
            cursor = c.date(byAdding: .day, value: -1, to: cursor) ?? cursor
        }
        while met(cursor) {
            currentStreak += 1
            cursor = c.date(byAdding: .day, value: -1, to: cursor) ?? cursor
        }

        // Longest streak ever: scan the sorted set of goal-met days.
        let metDays = counts
            .filter { $0.value >= goal }
            .keys
            .sorted()
        var longest = 0
        var run = 0
        var previous: Date?
        let parser = dayKeyParser()
        for key in metDays {
            guard let d = parser(key) else { continue }
            if let prev = previous,
               let next = c.date(byAdding: .day, value: 1, to: prev),
               c.isDate(next, inSameDayAs: d) {
                run += 1
            } else {
                run = 1
            }
            longest = max(longest, run)
            previous = d
        }

        let bestDay = counts.values.max() ?? 0
        let activeDays = counts.count
        let avg = activeDays > 0
            ? Double(read.count) / Double(activeDays) : 0

        // Per-week papers-read counts for the last `weeks` weeks (bar chart).
        var buckets: [String: Int] = [:]
        var order: [String] = []
        var weekCursor = weekStartDate
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
            dailyGoal: goal,
            readToday: readToday,
            readThisWeek: readThisWeek,
            readThisMonth: readThisMonth,
            papersReadTotal: read.count,
            pendingCount: pending.count,
            libraryCount: papers.count,
            currentStreakDays: currentStreak,
            longestStreakDays: longest,
            bestDayCount: bestDay,
            activeDaysCount: activeDays,
            averagePerActiveDay: avg,
            perWeek: perWeek,
            countsByDay: counts,
            firstActiveDay: firstActiveDay)
    }

    /// Classifies a calendar day for colouring, given the per-day counts.
    static func status(
        for date: Date,
        countsByDay: [String: Int],
        goal: Int,
        firstActiveDay: Date?,
        now: Date = Date()
    ) -> DayStatus {
        let c = calendar
        let day = c.startOfDay(for: date)
        let today = c.startOfDay(for: now)
        if day > today { return .future }

        let count = countsByDay[dayKey(day)] ?? 0
        if day == today {
            if count >= goal { return .met }
            return count > 0 ? .partial : .today
        }
        // Past day.
        guard let first = firstActiveDay, day >= c.startOfDay(for: first) else {
            return .untracked
        }
        if count >= goal { return .met }
        return count > 0 ? .partial : .missed
    }

    /// Lightweight (streak, readToday, goal) for the widget without building the
    /// full stats struct elsewhere.
    static func quickGamification(
        papers: [CachedPaper], now: Date = Date()
    ) -> (streak: Int, readToday: Int, goal: Int) {
        let s = compute(papers: papers, sessions: [], now: now)
        return (s.currentStreakDays, s.readToday, s.dailyGoal)
    }

    private static func dayKeyParser() -> (String) -> Date? {
        let f = DateFormatter()
        f.calendar = calendar
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return { f.date(from: $0) }
    }
}
