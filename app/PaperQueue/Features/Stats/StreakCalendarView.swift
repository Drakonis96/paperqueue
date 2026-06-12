import SwiftData
import SwiftUI

/// A month calendar where each day is tinted by how it did against the daily
/// goal: green when met, orange when partial, red when missed. Future and
/// pre-tracking days stay neutral. Navigable month-by-month. Tapping a day
/// shows a sheet with the papers read on that day.
struct StreakCalendarView: View {
    let countsByDay: [String: Int]
    let goal: Int
    let firstActiveDay: Date?

    @Query(
        filter: #Predicate<CachedPaper> { $0.readStatus == "read" },
        sort: [SortDescriptor(\CachedPaper.title)]
    )
    private var readPapers: [CachedPaper]

    @State private var monthAnchor: Date = StatsService.calendar
        .dateInterval(of: .month, for: Date())?.start ?? Date()
    @State private var selectedDay: Date?

    private var cal: Calendar { StatsService.calendar }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            weekdayRow
            grid
                .id(monthKey)
                .transition(.opacity)
            legend
        }
        .padding()
        .background(Theme.cardBackground, in: RoundedRectangle(
            cornerRadius: Theme.cornerRadius))
        .sheet(item: $selectedDay) { day in
            dayReadsSheet(day)
        }
    }

    private var header: some View {
        HStack {
            Label("Calendar", systemImage: "calendar")
                .font(.headline)
            Spacer()
            Button {
                withAnimation(Theme.subtleSpring) { shiftMonth(-1) }
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(PressableButtonStyle())
            Text(monthTitle)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .frame(minWidth: 116)
            Button {
                withAnimation(Theme.subtleSpring) { shiftMonth(1) }
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(PressableButtonStyle())
            .disabled(isCurrentMonth)
            .opacity(isCurrentMonth ? 0.3 : 1)
        }
    }

    private var weekdayRow: some View {
        HStack(spacing: 4) {
            ForEach(weekdaySymbols.indices, id: \.self) { i in
                Text(weekdaySymbols[i])
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var grid: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        return LazyVGrid(columns: columns, spacing: 4) {
            ForEach(Array(days.enumerated()), id: \.offset) { _, day in
                if let day {
                    DayCell(
                        date: day,
                        count: countsByDay[StatsService.dayKey(day)] ?? 0,
                        status: StatsService.status(
                            for: day, countsByDay: countsByDay, goal: goal,
                            firstActiveDay: firstActiveDay),
                        onTap: { selectedDay = day }
                    )
                } else {
                    Color.clear.frame(height: 34)
                }
            }
        }
    }

    private var legend: some View {
        HStack(spacing: 14) {
            LegendDot(color: .green, label: "Goal met")
            LegendDot(color: .orange, label: "Partial")
            LegendDot(color: .red, label: "Missed")
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .padding(.top, 2)
    }

    // MARK: - Date math

    private var days: [Date?] {
        let comps = cal.dateComponents([.year, .month], from: monthAnchor)
        guard let firstOfMonth = cal.date(from: comps),
              let range = cal.range(of: .day, in: .month, for: firstOfMonth)
        else { return [] }
        let weekday = cal.component(.weekday, from: firstOfMonth)
        let leading = (weekday - cal.firstWeekday + 7) % 7
        var result: [Date?] = Array(repeating: nil, count: leading)
        for day in range {
            result.append(cal.date(
                byAdding: .day, value: day - 1, to: firstOfMonth))
        }
        return result
    }

    private let weekdaySymbols: [String] = {
        let cal = StatsService.calendar
        let base = cal.veryShortWeekdaySymbols
        let start = cal.firstWeekday - 1
        return (0..<7).map { base[($0 + start) % 7] }
    }()

    private var monthTitle: String {
        let f = DateFormatter()
        f.calendar = cal
        f.dateFormat = "LLLL yyyy"
        return f.string(from: monthAnchor).capitalized
    }

    private var monthKey: String { StatsService.dayKey(monthAnchor) }

    private var isCurrentMonth: Bool {
        let nowMonth = cal.dateInterval(of: .month, for: Date())?.start
        return cal.isDate(monthAnchor, equalTo: nowMonth ?? Date(),
                          toGranularity: .month)
    }

    private func shiftMonth(_ delta: Int) {
        guard let next = cal.date(
            byAdding: .month, value: delta, to: monthAnchor) else { return }
        let nowMonth = cal.dateInterval(of: .month, for: Date())?.start ?? Date()
        if delta > 0 && next > nowMonth { return }
        monthAnchor = next
    }

    // MARK: - Day tap sheet

    private func papersForDay(_ day: Date) -> [CachedPaper] {
        let key = StatsService.dayKey(day)
        return readPapers.filter { paper in
            guard let d = paper.readDate else { return false }
            return StatsService.dayKey(d) == key
        }
    }

    private func dayReadsSheet(_ day: Date) -> some View {
        let papers = papersForDay(day)
        let dateLabel = day.formatted(
            Date.FormatStyle()
                .weekday(.wide)
                .year(.defaultDigits)
                .month(.wide)
                .day(.defaultDigits))

        return NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(papers.count) \(papers.count == 1 ? "paper" : "papers") read")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
                    .padding(.bottom, 12)

                if papers.isEmpty {
                    ContentUnavailableView(
                        "No papers read",
                        systemImage: "book",
                        description: Text("Nothing was read on this day."))
                } else {
                    List {
                        ForEach(papers) { paper in
                            NavigationLink(value: QueueRoute.detail(paper.zoteroKey)) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(paper.title)
                                        .font(.headline)
                                        .lineLimit(2)
                                    Text(paper.authorLine)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                }
            }
            .navigationTitle(dateLabel)
            #if !os(macOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .navigationDestination(for: QueueRoute.self) { route in
                switch route {
                case let .detail(key): PaperDetailView(paperKey: key)
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { selectedDay = nil }
                }
            }
        }
    }
}

extension Date: @retroactive Identifiable {
    public var id: TimeInterval { timeIntervalSince1970 }
}

private struct DayCell: View {
    let date: Date
    let count: Int
    let status: DayStatus
    var onTap: (() -> Void)? = nil

    private var dayNumber: String {
        "\(StatsService.calendar.component(.day, from: date))"
    }

    private var fill: Color {
        switch status {
        case .met: return .green.opacity(0.85)
        case .partial: return .orange.opacity(0.8)
        case .missed: return .red.opacity(0.45)
        case .today, .future, .untracked: return .clear
        }
    }

    private var isToday: Bool {
        StatsService.calendar.isDateInToday(date)
    }

    private var textColor: Color {
        switch status {
        case .met, .partial, .missed: return .white
        default: return .primary
        }
    }

    var body: some View {
        Text(dayNumber)
            .font(.caption.weight(isToday ? .bold : .regular))
            .monospacedDigit()
            .foregroundStyle(textColor)
            .frame(maxWidth: .infinity)
            .frame(height: 34)
            .background(fill, in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                if isToday {
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Theme.accent, lineWidth: 2)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 8))
            .onTapGesture {
                onTap?()
            }
    }
}

private struct LegendDot: View {
    let color: Color
    let label: String
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label)
        }
    }
}
