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
        List {
            Section {
                ForEach(filtered) { paper in
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
                }
            } header: {
                Text("\(filtered.count) read")
            }
        }
    }
}
