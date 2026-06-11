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

    private var filtered: [CachedPaper] {
        guard !search.isEmpty else { return papers }
        let q = search.lowercased()
        return papers.filter {
            $0.title.lowercased().contains(q)
                || $0.authorLine.lowercased().contains(q)
        }
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
                    list
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
            Text("\(filtered.count) read")
        }
    }

    private func historyRow(_ paper: CachedPaper) -> some View {
        #if os(macOS)
        HStack(spacing: 10) {
            PaperRowView(paper: paper, showStatus: true)
            Spacer(minLength: 8)
            MacRowButton(icon: "arrow.uturn.left.circle.fill", tint: .blue,
                         help: "Send back to queue") { store.reset(paper) }
            MacRowButton(icon: "trash", tint: .secondary,
                         help: "Remove from history") { store.removeFromHistory(paper) }
        }
        .contentShape(Rectangle())
        .listRowBackground(
            selection == paper.zoteroKey
                ? Theme.accent.opacity(0.14) : Color.clear)
        .onTapGesture(count: 2) {
            path.append(QueueRoute.detail(paper.zoteroKey))
        }
        .onTapGesture { selection = paper.zoteroKey }
        #else
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
        #endif
    }
}
