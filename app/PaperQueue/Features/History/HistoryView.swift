import SwiftData
import SwiftUI

/// Papers already read, most recent first. Swipe to send one back to the queue.
struct HistoryView: View {
    @EnvironmentObject private var store: QueueStore

    @Query(
        filter: #Predicate<CachedPaper> { $0.readStatus == "read" },
        sort: [SortDescriptor(\CachedPaper.updatedAt, order: .reverse)]
    )
    private var papers: [CachedPaper]

    @State private var search = ""
    @State private var path = NavigationPath()
    #if os(macOS)
    @State private var selection: String?
    #endif

    @State private var dateRange: DateRange = .all
    @State private var customFrom: Date = Date()
    @State private var customTo: Date = Date()

    enum DateRange: String, CaseIterable {
        case all, today, week, month, year, custom
        var label: String {
            switch self {
            case .all: return "All time"
            case .today: return "Today"
            case .week: return "This week"
            case .month: return "This month"
            case .year: return "This year"
            case .custom: return "Custom dates…"
            }
        }
    }

    private var filtered: [CachedPaper] {
        var result = papers

        if !search.isEmpty {
            let q = search.lowercased()
            result = result.filter {
                $0.title.lowercased().contains(q)
                    || $0.authorLine.lowercased().contains(q)
            }
        }

        switch dateRange {
        case .all: break
        case .today: result = result.filter { paper in
            let d = paper.readDate ?? paper.updatedAt
            return Calendar.current.isDateInToday(d)
        }
        case .week: result = result.filter { paper in
            let d = paper.readDate ?? paper.updatedAt
            let ws = Calendar.current.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date()
            return d >= ws
        }
        case .month: result = result.filter { paper in
            let d = paper.readDate ?? paper.updatedAt
            return Calendar.current.isDate(d, equalTo: Date(), toGranularity: .month)
        }
        case .year: result = result.filter { paper in
            let d = paper.readDate ?? paper.updatedAt
            return Calendar.current.isDate(d, equalTo: Date(), toGranularity: .year)
        }
        case .custom: result = result.filter { paper in
            let d = paper.readDate ?? paper.updatedAt
            let day = Calendar.current.startOfDay(for: d)
            return day >= Calendar.current.startOfDay(for: customFrom)
                && day <= Calendar.current.startOfDay(for: customTo)
        }
        }

        return result
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if papers.isEmpty {
                    ContentUnavailableView(
                        "Nothing read yet",
                        systemImage: "checkmark.circle",
                        description: Text("Papers you finish show up here."))
                } else {
                    VStack(spacing: 0) {
                        dateFilterBar
                        list
                    }
                }
            }
            .navigationTitle("History")
            .searchable(text: $search, prompt: "Search read papers")
            .navigationDestination(for: QueueRoute.self) { route in
                switch route {
                case let .detail(key): PaperDetailView(paperKey: key)
                }
            }
        }
    }

    private var dateFilterBar: some View {
        VStack(spacing: 8) {
            Picker("Date range", selection: $dateRange) {
                ForEach(DateRange.allCases, id: \.self) { range in
                    Text(range.label).tag(range)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.top, 8)

            if dateRange == .custom {
                HStack(spacing: 12) {
                    DatePicker("From", selection: $customFrom, displayedComponents: .date)
                        .labelsHidden()
                        .datePickerStyle(.compact)
                    Text("–")
                        .foregroundStyle(.secondary)
                    DatePicker("To", selection: $customTo, displayedComponents: .date)
                        .labelsHidden()
                        .datePickerStyle(.compact)
                }
                .padding(.horizontal)
                .padding(.bottom, 6)
            }
        }
    }

    private var list: some View {
        ScrollViewReader { proxy in
            listContent
                .scrollTopButton(visible: filtered.count > 7, proxy: proxy)
        }
    }

    private var listContent: some View {
        List { historySection }
    }

    private var historySection: some View {
        Section {
            TopAnchorRow()
            ForEach(filtered) { paper in
                historyRow(paper)
            }
        } header: {
            if dateRange == .all {
                Text("\(filtered.count) read")
            } else {
                Text("\(filtered.count) read · \(dateRange.label)")
            }
        }
    }

    private func historyRow(_ paper: CachedPaper) -> some View {
        #if os(macOS)
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                PaperRowView(paper: paper, showStatus: true)
                readDateLabel(paper)
            }
            Spacer(minLength: 8)
            MacRowButton(icon: "arrow.uturn.left.circle.fill", tint: .blue,
                         help: "Send back to queue") { store.reset(paper) }
            MacRowButton(icon: "trash", tint: .secondary,
                         help: "Remove from history") { store.removeFromHistory(paper) }
        }
        .macRowInteraction(selection: $selection, key: paper.zoteroKey) {
            path.append(QueueRoute.detail(paper.zoteroKey))
        }
        #else
        VStack(alignment: .leading, spacing: 2) {
            NavigationLink(value: QueueRoute.detail(paper.zoteroKey)) {
                PaperRowView(paper: paper, showStatus: true)
            }
            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                Button {
                    store.reset(paper)
                } label: {
                    Label("To queue", systemImage: "arrow.uturn.left")
                }
                .tint(.blue)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                Button(role: .destructive) {
                    store.removeFromHistory(paper)
                } label: {
                    Label("Remove", systemImage: "trash")
                }
            }
            readDateLabel(paper)
        }
        #endif
    }

    @ViewBuilder
    private func readDateLabel(_ paper: CachedPaper) -> some View {
        if let date = paper.readDate {
            HStack(spacing: 4) {
                Image(systemName: "clock")
                    .font(.caption2)
                Text("Read \(Self.readDateFormatter.string(from: date))")
                    .font(.caption)
            }
            .foregroundStyle(Theme.accent)
            .padding(.leading, 42)
        }
    }

    private static let readDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f
    }()
}
