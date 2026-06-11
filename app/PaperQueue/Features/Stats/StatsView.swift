import Charts
import SwiftData
import SwiftUI

struct StatsView: View {
    @Query private var papers: [CachedPaper]
    @Query private var sessions: [ReadingSessionLocal]

    private var stats: LocalStats {
        StatsService.compute(papers: papers, sessions: sessions)
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Stats")
        }
    }

    private var content: some View {
        let stats = stats
        return ScrollView {
            VStack(spacing: 16) {
                goalHero(stats)
                streakRow(stats)
                statsGrid(stats)
                StreakCalendarView(
                    countsByDay: stats.countsByDay,
                    goal: stats.dailyGoal,
                    firstActiveDay: stats.firstActiveDay)
                weeklyChart(stats)
            }
            .padding()
        }
    }

    // MARK: - Today's goal

    private func goalHero(_ stats: LocalStats) -> some View {
        HStack(spacing: 18) {
            GoalRing(
                progress: stats.todayProgress,
                read: stats.readToday,
                goal: stats.dailyGoal)
                .frame(width: 116, height: 116)

            VStack(alignment: .leading, spacing: 6) {
                if stats.goalMetToday {
                    Label("Goal reached", systemImage: "checkmark.seal.fill")
                        .font(.headline)
                        .foregroundStyle(.green)
                    Text("Nice work — you hit today's goal.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Today's goal")
                        .font(.headline)
                    Text(remaining(stats))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(Theme.cardBackground, in: RoundedRectangle(
            cornerRadius: Theme.cornerRadius))
    }

    private func remaining(_ stats: LocalStats) -> String {
        let left = max(stats.dailyGoal - stats.readToday, 0)
        let unit = left == 1 ? "paper" : "papers"
        return "\(left) more \(unit) to reach your goal of \(stats.dailyGoal)."
    }

    // MARK: - Streaks

    private func streakRow(_ stats: LocalStats) -> some View {
        HStack(spacing: 12) {
            StreakCard(
                title: "Current streak",
                value: stats.currentStreakDays,
                systemImage: "flame.fill",
                tint: .orange,
                animated: stats.currentStreakDays > 0)
            StreakCard(
                title: "Best streak",
                value: stats.longestStreakDays,
                systemImage: "trophy.fill",
                tint: .yellow,
                animated: false)
        }
    }

    // MARK: - Stats grid

    private func statsGrid(_ stats: LocalStats) -> some View {
        let columns = [GridItem(.flexible()), GridItem(.flexible())]
        return LazyVGrid(columns: columns, spacing: 12) {
            StatCard(title: "Read today", value: "\(stats.readToday)",
                     unit: "papers", systemImage: "sun.max.fill", tint: .orange)
            StatCard(title: "This week", value: "\(stats.readThisWeek)",
                     unit: "papers", systemImage: "calendar", tint: .blue)
            StatCard(title: "This month", value: "\(stats.readThisMonth)",
                     unit: "papers", systemImage: "calendar.badge.clock",
                     tint: .teal)
            StatCard(title: "Total read", value: "\(stats.papersReadTotal)",
                     unit: "papers", systemImage: "checkmark.circle.fill",
                     tint: .green)
            StatCard(title: "Best day", value: "\(stats.bestDayCount)",
                     unit: "papers", systemImage: "star.fill", tint: .pink)
            StatCard(title: "Daily average", value: avgText(stats),
                     unit: "per active day", systemImage: "chart.line.uptrend.xyaxis",
                     tint: .indigo)
            StatCard(title: "Pending", value: "\(stats.pendingCount)",
                     unit: "to read", systemImage: "tray.full.fill", tint: .purple)
            StatCard(title: "Library", value: "\(stats.libraryCount)",
                     unit: "items", systemImage: "books.vertical.fill", tint: .blue)
        }
    }

    private func avgText(_ stats: LocalStats) -> String {
        String(format: "%.1f", stats.averagePerActiveDay)
    }

    // MARK: - Weekly chart

    private func weeklyChart(_ stats: LocalStats) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Papers read per week", systemImage: "chart.bar.fill")
                .font(.headline)
            Chart {
                ForEach(stats.perWeek) { bucket in
                    BarMark(
                        x: .value("Week", shortLabel(bucket.weekStart)),
                        y: .value("Papers", bucket.papersRead)
                    )
                    .foregroundStyle(Theme.accent.gradient)
                    .cornerRadius(4)
                }
                RuleMark(y: .value("Weekly goal", stats.dailyGoal * 7))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .foregroundStyle(.green)
                    .annotation(position: .top, alignment: .leading) {
                        Text("Weekly goal")
                            .font(.caption2)
                            .foregroundStyle(.green)
                    }
            }
            .frame(height: 200)
        }
        .padding()
        .background(Theme.cardBackground, in: RoundedRectangle(
            cornerRadius: Theme.cornerRadius))
    }

    private func shortLabel(_ weekStart: String) -> String {
        let parts = weekStart.split(separator: "-")
        guard parts.count == 3 else { return weekStart }
        return "\(parts[1])/\(parts[2])"
    }
}

// MARK: - Components

/// Circular progress toward the daily goal.
private struct GoalRing: View {
    let progress: Double
    let read: Int
    let goal: Int

    private var done: Bool { progress >= 1 }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.secondary.opacity(0.18), lineWidth: 12)
            Circle()
                .trim(from: 0, to: max(progress, 0.0001))
                .stroke(
                    (done ? Color.green : Theme.accent).gradient,
                    style: StrokeStyle(lineWidth: 12, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(Theme.subtleSpring, value: progress)
            VStack(spacing: 1) {
                Image(systemName: done ? "checkmark" : "book.fill")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(done ? .green : Theme.accent)
                Text("\(read)/\(goal)")
                    .font(.title3.bold())
                    .monospacedDigit()
            }
        }
    }
}

private struct StreakCard: View {
    let title: String
    let value: Int
    let systemImage: String
    let tint: Color
    let animated: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: systemImage)
                .font(.title2)
                .foregroundStyle(tint)
                .symbolEffect(.pulse, isActive: animated)
            Text("\(value)")
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(Theme.subtleSpring, value: value)
            Text(value == 1 ? "day · \(title.lowercased())"
                            : "days · \(title.lowercased())")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Theme.cardBackground, in: RoundedRectangle(
            cornerRadius: Theme.cornerRadius))
    }
}

private struct StatCard: View {
    let title: String
    let value: String
    let unit: String
    let systemImage: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: systemImage)
                .font(.caption)
                .foregroundStyle(tint)
                .lineLimit(1)
            Text(value)
                .font(.title.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
                .animation(Theme.subtleSpring, value: value)
            Text(unit)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Theme.cardBackground, in: RoundedRectangle(
            cornerRadius: Theme.cornerRadius))
    }
}
