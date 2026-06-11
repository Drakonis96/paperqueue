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

/// How the Library list is ordered. Persisted across launches.
enum LibrarySort: String, CaseIterable, Identifiable {
    case recentlyAdded = "Recently added"
    case oldestAdded = "Oldest added"
    case titleAZ = "Title (A–Z)"
    case authorAZ = "Author (A–Z)"
    case yearNewest = "Year (newest)"
    case yearOldest = "Year (oldest)"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .recentlyAdded: return "clock.arrow.circlepath"
        case .oldestAdded: return "clock"
        case .titleAZ: return "textformat"
        case .authorAZ: return "person"
        case .yearNewest, .yearOldest: return "calendar"
        }
    }

    /// Returns `papers` ordered by this option.
    func apply(to papers: [CachedPaper]) -> [CachedPaper] {
        switch self {
        case .recentlyAdded:
            return papers.sorted { ($0.addedAt ?? "") > ($1.addedAt ?? "") }
        case .oldestAdded:
            // Items without a date sort to the end.
            return papers.sorted {
                ($0.addedAt ?? "~") < ($1.addedAt ?? "~")
            }
        case .titleAZ:
            return papers.sorted {
                $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending
            }
        case .authorAZ:
            return papers.sorted {
                let a = $0.authors.first ?? "~"
                let b = $1.authors.first ?? "~"
                let cmp = a.localizedCaseInsensitiveCompare(b)
                if cmp == .orderedSame {
                    return $0.title.localizedCaseInsensitiveCompare($1.title)
                        == .orderedAscending
                }
                return cmp == .orderedAscending
            }
        case .yearNewest:
            return papers.sorted { ($0.year ?? "") > ($1.year ?? "") }
        case .yearOldest:
            return papers.sorted { ($0.year ?? "~") < ($1.year ?? "~") }
        }
    }
}

/// The whole cached library: filter, search, add-by-DOI, browse collections.
struct LibraryView: View {
    @EnvironmentObject private var store: QueueStore

    @Query(sort: [SortDescriptor(\CachedPaper.addedAt, order: .reverse)])
    private var papers: [CachedPaper]

    @AppStorage("librarySort") private var sortRaw = LibrarySort.recentlyAdded.rawValue
    private var sort: LibrarySort { LibrarySort(rawValue: sortRaw) ?? .recentlyAdded }

    /// Animates the list reorder when the sort option changes.
    private var sortBinding: Binding<LibrarySort> {
        Binding(
            get: { sort },
            set: { newValue in
                withAnimation(.easeInOut(duration: 0.28)) { sortRaw = newValue.rawValue }
            })
    }

    @State private var search = ""
    @State private var filter: LibraryFilter = .all
    @State private var collections: [ZoteroCollection] = []
    @State private var selectedCollection: String?
    @State private var selectedAuthors: Set<String> = []
    @State private var selectedTags: Set<String> = []
    @State private var selectedYears: Set<String> = []
    @State private var showingAdd = false
    @State private var showingCollections = false
    @State private var showingFilters = false
    @State private var path = NavigationPath()
    #if os(macOS)
    @State private var selection: String?
    #endif

    /// Distinct authors across the library, for the author filter.
    private var allAuthors: [String] {
        Set(papers.flatMap(\.authors))
            .filter { !$0.isEmpty }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    /// Distinct user tags (excludes pq: state tags and hidden `_` tags).
    private var allTags: [String] {
        Set(papers.flatMap(\.tags))
            .filter { !$0.hasPrefix("pq:") && !$0.hasPrefix("_") }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    /// Distinct publication years, newest first.
    private var allYears: [String] {
        Set(papers.compactMap(\.year))
            .sorted { $0 > $1 }
    }

    private var activeFilterCount: Int {
        var n = selectedAuthors.count + selectedTags.count + selectedYears.count
        if filter != .all { n += 1 }
        if selectedCollection != nil { n += 1 }
        return n
    }

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
        if !selectedAuthors.isEmpty {
            result = result.filter { !selectedAuthors.isDisjoint(with: $0.authors) }
        }
        if !selectedTags.isEmpty {
            result = result.filter { !selectedTags.isDisjoint(with: $0.tags) }
        }
        if !selectedYears.isEmpty {
            result = result.filter {
                if let y = $0.year { return selectedYears.contains(y) }
                return false
            }
        }
        if !search.isEmpty {
            let q = search.lowercased()
            result = result.filter {
                $0.title.lowercased().contains(q)
                    || $0.authorLine.lowercased().contains(q)
                    || ($0.publicationTitle?.lowercased().contains(q) ?? false)
            }
        }
        return sort.apply(to: result)
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if store.isSyncing && papers.isEmpty {
                    loadingLibrary
                        .transition(.opacity)
                } else if papers.isEmpty {
                    emptyLibrary
                        .transition(.opacity)
                } else {
                    list
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.3), value: papers.isEmpty)
            .animation(.easeInOut(duration: 0.3), value: store.isSyncing)
            .navigationTitle("Library")
            .searchable(text: $search, prompt: "Search title, author, journal")
            .safeAreaInset(edge: .top) {
                // Show refresh progress over an already-populated list (the
                // first, empty-state load uses the centered loadingLibrary view).
                if !papers.isEmpty { SyncProgressBar() }
            }
            .toolbar { toolbarContent }
            .refreshable { await store.syncLibrary() }
            .navigationDestination(for: QueueRoute.self) { route in
                switch route {
                case let .detail(key): PaperDetailView(paperKey: key)
                }
            }
            .sheet(isPresented: $showingAdd) { AddItemView() }
            .sheet(isPresented: $showingCollections) { CollectionsView() }
            .sheet(isPresented: $showingFilters) {
                LibraryFiltersView(
                    status: $filter,
                    selectedCollection: $selectedCollection,
                    selectedAuthors: $selectedAuthors,
                    selectedTags: $selectedTags,
                    selectedYears: $selectedYears,
                    collections: collections,
                    authors: allAuthors,
                    tags: allTags,
                    years: allYears)
            }
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

    private var list: some View {
        ScrollViewReader { proxy in
            listContent
                .animation(.easeInOut(duration: 0.28), value: filtered.map(\.zoteroKey))
                .scrollTopButton(visible: filtered.count > 7, proxy: proxy)
        }
    }

    private var listContent: some View {
        List { librarySections }
    }

    @ViewBuilder
    private var librarySections: some View {
        if activeFilterCount > 0 {
            Section { activeFilterChips }
        }
        Section {
            TopAnchorRow()
            ForEach(filtered) { paper in
                row(paper)
            }
        } header: {
            HStack {
                Text("^[\(filtered.count) item](inflect: true)")
                Spacer()
                Label(sort.rawValue, systemImage: sort.systemImage)
                    .labelStyle(.titleAndIcon)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .textCase(nil)
            }
        }
    }

    @ViewBuilder
    private var activeFilterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if filter != .all {
                    chip(filter.rawValue) { filter = .all }
                }
                if let key = selectedCollection,
                   let name = collections.first(where: { $0.key == key })?.name {
                    chip(name) { selectedCollection = nil }
                }
                ForEach(Array(selectedAuthors), id: \.self) { a in
                    chip(a) { selectedAuthors.remove(a) }
                }
                ForEach(Array(selectedTags), id: \.self) { t in
                    chip("#\(t)") { selectedTags.remove(t) }
                }
                ForEach(Array(selectedYears).sorted(by: >), id: \.self) { y in
                    chip(y) { selectedYears.remove(y) }
                }
            }
            .padding(.vertical, 2)
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
    }

    private func chip(_ text: String, onRemove: @escaping () -> Void) -> some View {
        Button(action: onRemove) {
            HStack(spacing: 4) {
                Text(text).lineLimit(1)
                Image(systemName: "xmark.circle.fill")
            }
            .font(.caption)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Theme.accent.opacity(0.15), in: Capsule())
            .foregroundStyle(Theme.accent)
        }
        .buttonStyle(.plain)
    }

    private func row(_ paper: CachedPaper) -> some View {
        #if os(macOS)
        HStack(spacing: 8) {
            PaperRowView(paper: paper, showStatus: true)
            quickAction(paper)
                .animation(Theme.subtleSpring, value: paper.isPending)
                .animation(Theme.subtleSpring, value: paper.readStatus)
        }
        .macRowInteraction(selection: $selection, key: paper.zoteroKey) {
            path.append(QueueRoute.detail(paper.zoteroKey))
        }
        .contextMenu { addToQueueMenu(paper) }
        #else
        HStack(spacing: 8) {
            PaperRowView(paper: paper, showStatus: true)
            quickAction(paper)
                .animation(Theme.subtleSpring, value: paper.isPending)
                .animation(Theme.subtleSpring, value: paper.readStatus)
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
        .contextMenu { addToQueueMenu(paper) }
        #endif
    }

    /// Visible per-row indicator/action so queue membership is obvious at a
    /// glance and adding is one tap.
    @ViewBuilder
    private func quickAction(_ paper: CachedPaper) -> some View {
        if paper.readStatus == "read" {
            Image(systemName: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .contentTransition(.symbolEffect(.replace))
                .help("Read")
        } else if paper.isPending {
            // In a queue — show a clear green check (plus the queue name when
            // it isn't the Default queue).
            HStack(spacing: 4) {
                if let name = paper.queueName {
                    Text(name)
                        .font(.caption2)
                        .foregroundStyle(.green)
                        .lineLimit(1)
                }
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .contentTransition(.symbolEffect(.replace))
            }
            .help(paper.queueName.map { "In “\($0)” queue" } ?? "In your reading queue")
        } else if store.availableQueues.count > 1 {
            // Tap adds to Default; long-press/▾ picks a specific queue.
            Menu {
                ForEach(store.availableQueues, id: \.self) { queue in
                    Button {
                        store.addToQueue(paper, queue: queue)
                    } label: {
                        Label("Add to \(queue)", systemImage: queue
                            == AppConfig.defaultQueueName ? "tray.full" : "tray")
                    }
                }
            } label: {
                Image(systemName: "plus.circle.fill")
                    .foregroundStyle(Theme.accent)
            } primaryAction: {
                store.addToQueue(paper)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Add to reading queue")
        } else {
            Button { store.addToQueue(paper) } label: {
                Image(systemName: "plus.circle.fill")
                    .foregroundStyle(Theme.accent)
            }
            .buttonStyle(PressableButtonStyle())
            .help("Add to reading queue")
        }
    }

    /// Long-press context menu for a library row: add to / move between queues.
    @ViewBuilder
    private func addToQueueMenu(_ paper: CachedPaper) -> some View {
        if paper.readStatus != "read" {
            if paper.isPending {
                if store.availableQueues.count > 1 {
                    Menu("Move to queue", systemImage: "tray.and.arrow.down") {
                        ForEach(store.availableQueues, id: \.self) { queue in
                            let current = paper.queueName
                                ?? AppConfig.defaultQueueName
                            Button {
                                store.moveToQueue(paper, queue: queue)
                            } label: {
                                Label(queue, systemImage: queue == current
                                    ? "checkmark" : "tray")
                            }
                            .disabled(queue == current)
                        }
                    }
                }
                Button(role: .destructive) {
                    store.removeFromQueue(paper)
                } label: {
                    Label("Remove from queue", systemImage: "minus.circle")
                }
            } else if store.availableQueues.count > 1 {
                Menu("Add to queue", systemImage: "text.badge.plus") {
                    ForEach(store.availableQueues, id: \.self) { queue in
                        Button {
                            store.addToQueue(paper, queue: queue)
                        } label: {
                            Label(queue, systemImage: queue
                                == AppConfig.defaultQueueName ? "tray.full" : "tray")
                        }
                    }
                }
            } else {
                Button {
                    store.addToQueue(paper)
                } label: {
                    Label("Add to queue", systemImage: "text.badge.plus")
                }
            }
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

    private var loadingLibrary: some View {
        VStack(spacing: 16) {
            ProgressView(value: store.syncProgress ?? 0) {
                Text("Loading library…")
            }
            .progressViewStyle(.linear)
            .frame(maxWidth: 280)
            Text(store.syncSummary ?? "Fetching your Zotero items…")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button { showingAdd = true } label: { Image(systemName: "plus") }
                .help("Add a paper by DOI")
        }
        ToolbarItem(placement: .secondaryAction) {
            Menu {
                Picker("Sort by", selection: sortBinding) {
                    ForEach(LibrarySort.allCases) { option in
                        Label(option.rawValue, systemImage: option.systemImage)
                            .tag(option)
                    }
                }
            } label: {
                Label("Sort: \(sort.rawValue)", systemImage: "arrow.up.arrow.down")
            }
        }
        ToolbarItem(placement: .secondaryAction) {
            Button { showingFilters = true } label: {
                Label(activeFilterCount > 0
                    ? "Filters (\(activeFilterCount))" : "Filters",
                    systemImage: activeFilterCount > 0
                        ? "line.3.horizontal.decrease.circle.fill"
                        : "line.3.horizontal.decrease.circle")
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
