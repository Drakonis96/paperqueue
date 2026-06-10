import SwiftData
import SwiftUI

/// Navigation routes inside the paper lists.
enum QueueRoute: Hashable {
    case detail(String)
}

struct QueueView: View {
    @EnvironmentObject private var store: QueueStore
    @EnvironmentObject private var router: AppRouter

    @Query(
        filter: #Predicate<CachedPaper> { $0.isPending },
        sort: [SortDescriptor(\CachedPaper.sortPriority),
               SortDescriptor(\CachedPaper.zoteroKey)]
    )
    private var allPending: [CachedPaper]

    @State private var path = NavigationPath()
    @State private var showingNewQueue = false
    @State private var newQueueName = ""
    @State private var showingDeleteQueue = false

    /// Papers in the currently selected queue.
    private var papers: [CachedPaper] {
        let stored = store.activeQueue == AppConfig.defaultQueueName
            ? nil : store.activeQueue
        return allPending.filter { $0.queueName == stored }
    }

    private var showError: Binding<Bool> {
        Binding(
            get: { store.lastError != nil },
            set: { if !$0 { store.lastError = nil } })
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if papers.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .navigationTitle(store.activeQueue == AppConfig.defaultQueueName
                ? "Reading Queue" : store.activeQueue)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { toolbarContent }
            .safeAreaInset(edge: .top) { syncProgressBar }
            .refreshable { await store.syncLibrary() }
            .navigationDestination(for: QueueRoute.self) { route in
                switch route {
                case let .detail(key):
                    PaperDetailView(paperKey: key)
                }
            }
            .overlay(alignment: .bottom) { offlineBanner }
            .alert("Sync problem", isPresented: showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(store.lastError ?? "")
            }
            .alert("New queue", isPresented: $showingNewQueue) {
                TextField("Queue name", text: $newQueueName)
                Button("Create") {
                    store.createQueue(newQueueName)
                    newQueueName = ""
                }
                Button("Cancel", role: .cancel) { newQueueName = "" }
            } message: {
                Text("Group papers into a separate reading queue.")
            }
            .confirmationDialog(
                "Delete “\(store.activeQueue)”?",
                isPresented: $showingDeleteQueue,
                titleVisibility: .visible
            ) {
                Button("Delete queue", role: .destructive) {
                    store.deleteQueue(store.activeQueue)
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Its papers move back to the Default queue.")
            }
        }
        .onChange(of: router.readerPaperKey) { _, newValue in
            if let key = newValue {
                path.append(QueueRoute.detail(key))
                router.readerPaperKey = nil
            }
        }
    }

    @ViewBuilder
    private var syncProgressBar: some View {
        if store.isSyncing {
            VStack(spacing: 4) {
                if let progress = store.syncProgress {
                    ProgressView(value: progress)
                } else {
                    ProgressView(value: 0).progressViewStyle(.linear)
                }
                Text(store.syncSummary ?? "Fetching library…")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
            .background(.bar)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private var list: some View {
        List {
            Section {
                ForEach(papers) { paper in
                    NavigationLink(value: QueueRoute.detail(paper.zoteroKey)) {
                        PaperRowView(paper: paper)
                    }
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button {
                            store.markRead(paper)
                        } label: {
                            Label("Read", systemImage: "checkmark")
                        }
                        .tint(.green)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button {
                            store.postpone(paper)
                        } label: {
                            Label("Later", systemImage: "clock")
                        }
                        .tint(.orange)

                        Button(role: .destructive) {
                            store.skip(paper)
                        } label: {
                            Label("Skip", systemImage: "xmark")
                        }

                        Button {
                            store.removeFromQueue(paper)
                        } label: {
                            Label("Remove", systemImage: "minus.circle")
                        }
                        .tint(.gray)
                    }
                    .contextMenu { moveMenu(paper) }
                }
                .onMove(perform: move)
            } header: {
                Text("\(papers.count) to read · drag to reorder")
            }
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        #endif
    }

    @ViewBuilder
    private func moveMenu(_ paper: CachedPaper) -> some View {
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
    }

    private func move(from: IndexSet, to: Int) {
        var arr = papers
        arr.move(fromOffsets: from, toOffset: to)
        store.reorderPending(arr)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Queue clear", systemImage: "checkmark.circle")
        } description: {
            Text(store.syncSummary
                ?? "Add papers from your library to build a reading queue.")
        } actions: {
            VStack(spacing: 10) {
                Button {
                    router.selectedTab = .library
                } label: {
                    Label("Browse Library", systemImage: "books.vertical")
                }
                .buttonStyle(.borderedProminent)

                Button("Sync Library") { Task { await store.syncLibrary() } }
                    .buttonStyle(.bordered)
                    .disabled(store.isSyncing)
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        #if os(iOS)
        ToolbarItem(placement: .topBarLeading) { EditButton() }
        #endif
        ToolbarItem(placement: .principal) { queueMenu }
        ToolbarItem(placement: .primaryAction) {
            Button {
                Task { await store.syncLibrary() }
            } label: {
                if store.isSyncing {
                    ProgressView()
                } else {
                    Image(systemName: "arrow.triangle.2.circlepath")
                }
            }
            .disabled(store.isSyncing)
        }
    }

    private var queueMenu: some View {
        Menu {
            Picker("Queue", selection: Binding(
                get: { store.activeQueue },
                set: { store.setActiveQueue($0) })
            ) {
                ForEach(store.availableQueues, id: \.self) { queue in
                    Label(queue, systemImage: queue == AppConfig.defaultQueueName
                        ? "tray.full" : "tray").tag(queue)
                }
            }
            Divider()
            Button {
                showingNewQueue = true
            } label: {
                Label("New Queue…", systemImage: "plus")
            }
            if store.activeQueue != AppConfig.defaultQueueName {
                Button(role: .destructive) {
                    showingDeleteQueue = true
                } label: {
                    Label("Delete “\(store.activeQueue)”", systemImage: "trash")
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(store.activeQueue == AppConfig.defaultQueueName
                    ? "Reading Queue" : store.activeQueue)
                    .font(.headline)
                Image(systemName: "chevron.down")
                    .font(.caption2)
            }
            .foregroundStyle(.primary)
        }
    }

    @ViewBuilder
    private var offlineBanner: some View {
        if store.isOffline {
            Label("Offline — changes will sync later", systemImage: "wifi.slash")
                .font(.caption)
                .padding(8)
                .background(.thinMaterial, in: Capsule())
                .padding(.bottom, 8)
        }
    }
}
