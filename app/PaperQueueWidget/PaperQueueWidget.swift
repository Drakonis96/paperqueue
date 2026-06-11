import SwiftUI
import WidgetKit

struct PaperQueueEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct PaperQueueProvider: TimelineProvider {
    func placeholder(in context: Context) -> PaperQueueEntry {
        PaperQueueEntry(
            date: Date(),
            snapshot: WidgetSnapshot(
                pendingCount: 5,
                nextTitle: "Attention Is All You Need",
                nextAuthors: "Vaswani et al.",
                nextPaperKey: nil,
                updatedAt: Date()))
    }

    func getSnapshot(
        in context: Context,
        completion: @escaping (PaperQueueEntry) -> Void
    ) {
        completion(PaperQueueEntry(date: Date(), snapshot: WidgetBridge.read()))
    }

    func getTimeline(
        in context: Context,
        completion: @escaping (Timeline<PaperQueueEntry>) -> Void
    ) {
        let entry = PaperQueueEntry(date: Date(), snapshot: WidgetBridge.read())
        // The app reloads timelines on every change; this is just a fallback.
        let next = Date().addingTimeInterval(30 * 60)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct PaperQueueWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: PaperQueueEntry

    private var snapshot: WidgetSnapshot { entry.snapshot }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "books.vertical.fill")
                    .foregroundStyle(.tint)
                Text("\(snapshot.pendingCount)")
                    .font(.system(.title, design: .rounded).bold())
                Text("to read")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            }

            Spacer(minLength: 0)

            if let title = snapshot.nextTitle {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Up next")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(family == .systemSmall ? 2 : 3)
                    if family != .systemSmall, let authors = snapshot.nextAuthors {
                        Text(authors)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            } else {
                Label("All caught up", systemImage: "checkmark.seal.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.green)
            }

            Spacer(minLength: 0)
            gamificationFooter
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(WidgetBridge.readerURL(paperKey: snapshot.nextPaperKey))
        .containerBackground(.fill.tertiary, for: .widget)
    }

    /// Streak + today's goal progress.
    private var gamificationFooter: some View {
        HStack(spacing: 6) {
            if snapshot.streakDays > 0 {
                Label("\(snapshot.streakDays)", systemImage: "flame.fill")
                    .foregroundStyle(.orange)
            }
            Spacer(minLength: 0)
            HStack(spacing: 3) {
                Image(systemName: snapshot.goalMetToday
                    ? "checkmark.circle.fill" : "target")
                    .foregroundStyle(snapshot.goalMetToday ? .green : .secondary)
                Text("\(snapshot.readToday)/\(snapshot.dailyGoal)")
                    .foregroundStyle(.secondary)
            }
        }
        .font(.caption2.weight(.semibold))
    }
}

struct PaperQueueWidget: Widget {
    let kind = "PaperQueueWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PaperQueueProvider()) { entry in
            PaperQueueWidgetView(entry: entry)
        }
        .configurationDisplayName("Reading Queue")
        .description("How many papers are waiting, and what's next.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct PaperQueueWidgetBundle: WidgetBundle {
    var body: some Widget {
        PaperQueueWidget()
    }
}
