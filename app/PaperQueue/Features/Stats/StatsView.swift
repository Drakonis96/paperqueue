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
                HStack(spacing: 12) {
                    StatCard(
                        title: "Streak",
                        value: "\(stats.currentStreakDays)",
                        unit: "days",
                        systemImage: "flame.fill",
                        tint: .orange)
                    StatCard(
                        title: "Read",
                        value: "\(stats.papersReadTotal)",
                        unit: "papers",
                        systemImage: "checkmark.circle.fill",
                        tint: .green)
                }
                HStack(spacing: 12) {
                    StatCard(
                        title: "Pending",
                        value: "\(stats.pendingCount)",
                        unit: "to read",
                        systemImage: "tray.full.fill",
                        tint: .purple)
                    StatCard(
                        title: "Library",
                        value: "\(papers.count)",
                        unit: "papers",
                        systemImage: "books.vertical.fill",
                        tint: .blue)
                }

                weeklyChart(stats)
            }
            .padding()
        }
    }

    private func weeklyChart(_ stats: LocalStats) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Papers read per week")
                .font(.headline)
            Chart(stats.perWeek) { bucket in
                BarMark(
                    x: .value("Week", shortLabel(bucket.weekStart)),
                    y: .value("Papers", bucket.papersRead)
                )
                .foregroundStyle(Theme.accent)
                .cornerRadius(4)
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
            Text(value)
                .font(.title.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(unit)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Theme.cardBackground, in: RoundedRectangle(
            cornerRadius: Theme.cornerRadius))
    }
}
