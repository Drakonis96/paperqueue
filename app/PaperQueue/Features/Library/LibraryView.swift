import SwiftData
import SwiftUI

enum LibraryFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case queue = "In Queue"
    case unread = "Unread"
    case read = "Read"

    var id: String { rawValue }
    var systemImage: String {
        switch self {
        case .all: return "tray.full"
        case .queue: return "text.badge.plus"
        case .unread: return "circle"
        case .read: return "checkmark.circle"
        }
    }
}

/// The whole cached library: filter, search, add-by-DOI, browse collections.
struct LibraryView: View {
    @EnvironmentObject private var store: QueueStore

    @Query(sort: [SortDescriptor(\CachedPaper.addedAt, order: .reverse)])
    private var papers: [CachedPaper]

    @State private var search = ""
    @State private var filter: LibraryFilter = .all
    @State private var collections: [ZoteroCollection] = []
    @State private var selectedCollection: String?
    @State private var showingAdd = false
    @State private var showingCollections = false
    @State private var path = NavigationPath()

    private var filtered: [CachedPaper] {
        var result = papers
        switch filter {
        case .all: break
        case .queue: result = result.filter { $0.isPending }
        case .unread: result = result.filter {
            $0.readStatus == "unread" && !$0.isPending
        }
        case .read: result = result.filter { $0.readStatus == "read" }
        }
        if let key = selectedCollection {
            result = result.filter { $0.collectionKeys?.contains(key) ?? false }
        }
        if !search.isEmpty {
            let q = search.lowercased()
            result = result.filter {
                $0.title.lowercased().contains(q)
                    || $0.authorLine.lowercased().contains(q)
                    || ($0.publicationTitle?.lowercased().contains(q) ?? false)
            }
        }
        return result
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if papers.isEmpty {
                    emptyLibrary
                } else {
                    list
                }
            }
            .navigationTitle("Library")
            .searchable(text: $search, prompt: "Search title, author, journal")
            .toolbar { toolbarContent }
            .navigationDestination(for: QueueRoute.self) { route in
                switch route {
                case let .detail(key): PaperDetailView(paperKey: key)
                }
            }
            .sheet(isPresented: $showingAdd) { AddItemView() }
            .sheet(isPresented: $showingCollections) { CollectionsView() }
            .task { await loadCollections() }
        }
    }

    private func loadCollections() async {
        guard collections.isEmpty, let zotero = ZoteroAPI.current() else { return }
        if let all = try? await zotero.allCollections() {
            collections = all.sorted {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
        }
    }

    private var filterLabel: String {
        if let key = selectedCollection,
           let name = collections.first(where: { $0.key == key })?.name {
            return name
        }
        return filter.rawValue
    }

    private var list: some View {
        List {
            Section {
                ForEach(filtered) { paper in
                    row(paper)
                }
            } header: {
                Text("^[\(filtered.count) paper](inflect: true)")
            }
        }
    }

    private func row(_ paper: CachedPaper) -> some View {
        HStack(spacing: 8) {
            PaperRowView(paper: paper, showStatus: true)
            quickAction(paper)
        }
        .contentShape(Rectangle())
        .background {
            NavigationLink(value: QueueRoute.detail(paper.zoteroKey)) {
                EmptyView()
            }
            .opacity(0)
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if paper.readStatus == "read" || paper.readStatus == "skipped" {
                Button { store.reset(paper) } label: {
                    Label("To queue", systemImage: "arrow.uturn.left")
                }.tint(.blue)
            } else if paper.isPending {
                Button { store.markRead(paper) } label: {
                    Label("Read", systemImage: "checkmark")
                }.tint(.green)
            } else {
                Button { store.addToQueue(paper) } label: {
                    Label("Queue", systemImage: "text.badge.plus")
                }.tint(.blue)
            }
        }
    }

    /// Visible per-row action so it isn't hidden behind a swipe.
    @ViewBuilder
    private func quickAction(_ paper: CachedPaper) -> some View {
        if paper.readStatus == "read" {
            Image(systemName: "checkmark.seal.fill")
                .foregroundStyle(.green)
        } else if paper.isPending {
            Button { store.markRead(paper) } label: {
                Image(systemName: "checkmark.circle")
            }
            .buttonStyle(.borderless)
            .tint(.green)
            .help("Mark as read")
        } else {
            Button { store.addToQueue(paper) } label: {
                Image(systemName: "plus.circle.fill")
            }
            .buttonStyle(.borderless)
            .tint(.accentColor)
            .help("Add to reading queue")
        }
    }

    private var emptyLibrary: some View {
        ContentUnavailableView {
            Label("Empty library", systemImage: "books.vertical")
        } description: {
            Text("Sync your Zotero library or add a paper by DOI.")
        } actions: {
            Button("Sync Library") { Task { await store.syncLibrary() } }
                .buttonStyle(.borderedProminent)
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button { showingAdd = true } label: { Image(systemName: "plus") }
                .help("Add a paper by DOI")
        }
        ToolbarItem(placement: .secondaryAction) {
            Menu {
                Picker("Status", selection: $filter) {
                    ForEach(LibraryFilter.allCases) { f in
                        Label(f.rawValue, systemImage: f.systemImage).tag(f)
                    }
                }
                if !collections.isEmpty {
                    Picker("Collection", selection: $selectedCollection) {
                        Text("All collections").tag(String?.none)
                        ForEach(collections) { c in
                            Text(c.name).tag(String?.some(c.key))
                        }
                    }
                }
            } label: {
                Label("Filter: \(filterLabel)",
                      systemImage: "line.3.horizontal.decrease.circle")
            }
        }
        ToolbarItem(placement: .secondaryAction) {
            Button { showingCollections = true } label: {
                Label("Collections", systemImage: "folder")
            }
        }
        ToolbarItem(placement: .secondaryAction) {
            Button { Task { await store.syncLibrary() } } label: {
                Label("Sync", systemImage: "arrow.triangle.2.circlepath")
            }
            .disabled(store.isSyncing)
        }
    }
}
