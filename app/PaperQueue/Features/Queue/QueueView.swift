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
    private var papers: [CachedPaper]

    @State private var path = NavigationPath()

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
            .navigationTitle("Reading Queue")
            .toolbar { toolbarContent }
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
        }
        .onChange(of: router.readerPaperKey) { _, newValue in
            if let key = newValue {
                path.append(QueueRoute.detail(key))
                router.readerPaperKey = nil
            }
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
