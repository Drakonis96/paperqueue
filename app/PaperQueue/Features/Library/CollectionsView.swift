import SwiftUI

struct CollectionRef: Hashable {
    let key: String
    let name: String
}

/// Browse Zotero collections and subcollections, search inside, and add papers
/// to the reading queue.
struct CollectionsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var top: [ZoteroCollection] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView()
                } else if let error {
                    ContentUnavailableView(
                        "Couldn't load collections",
                        systemImage: "folder.badge.questionmark",
                        description: Text(error))
                } else if top.isEmpty {
                    ContentUnavailableView(
                        "No collections",
                        systemImage: "folder",
                        description: Text("Your Zotero library has no collections."))
                } else {
                    List(top) { collection in
                        NavigationLink(value: CollectionRef(
                            key: collection.key, name: collection.name)) {
                            Label(collection.name, systemImage: "folder")
                        }
                    }
                }
            }
            .navigationTitle("Collections")
            .navigationDestination(for: CollectionRef.self) { ref in
                CollectionContentsView(ref: ref)
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await load() }
        }
        // macOS sheets don't auto-size; without a frame the list collapses.
        #if os(macOS)
        .frame(minWidth: 460, idealWidth: 500, minHeight: 520, idealHeight: 600)
        #endif
    }

    private func load() async {
        guard let zotero = ZoteroAPI.current() else {
            error = "Not signed in."
            loading = false
            return
        }
        do {
            top = try await zotero.topCollections()
        } catch {
            self.error = (error as? APIError)?.errorDescription
                ?? error.localizedDescription
        }
        loading = false
    }
}

/// Contents of one collection: its subcollections and its papers.
struct CollectionContentsView: View {
    let ref: CollectionRef

    @EnvironmentObject private var store: QueueStore

    @State private var subcollections: [ZoteroCollection] = []
    @State private var items: [ZoteroItem] = []
    @State private var loading = true
    @State private var error: String?
    @State private var search = ""
    @State private var added: Set<String> = []

    private var filtered: [ZoteroItem] {
        guard !search.isEmpty else { return items }
        let q = search.lowercased()
        return items.filter {
            ($0.data.title?.lowercased().contains(q) ?? false)
                || authorLine($0).lowercased().contains(q)
        }
    }

    var body: some View {
        List {
            if !subcollections.isEmpty {
                Section("Subcollections") {
                    ForEach(subcollections) { sub in
                        NavigationLink(value: CollectionRef(
                            key: sub.key, name: sub.name)) {
                            Label(sub.name, systemImage: "folder")
                        }
                    }
                }
            }
            Section("Papers (\(items.count))") {
                if loading {
                    ProgressView()
                } else if let error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                } else {
                    ForEach(filtered, id: \.key) { item in
                        itemRow(item)
                    }
                }
            }
        }
        .navigationTitle(ref.name)
        .searchable(text: $search, prompt: "Search this collection")
        .task { await load() }
    }

    private func itemRow(_ item: ZoteroItem) -> some View {
        let queued = added.contains(item.key) || store.isQueued(item.key)
        return HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.data.title ?? "(untitled)")
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                Text(authorLine(item))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                store.enqueue(item)
                added.insert(item.key)
            } label: {
                Image(systemName: queued ? "checkmark.circle.fill" : "plus.circle")
                    .foregroundStyle(queued ? .green : Theme.accent)
            }
            .buttonStyle(.borderless)
            .disabled(queued)
        }
        .padding(.vertical, 2)
    }

    private func authorLine(_ item: ZoteroItem) -> String {
        let creators = item.data.creators ?? []
        func name(_ c: ZoteroCreator) -> String? {
            if let name = c.name { return name }
            if let last = c.lastName { return last }
            return c.firstName
        }
        // Prefer real authors so editors don't hide them; fall back to all.
        let authors = creators
            .filter { $0.creatorType.lowercased() == "author" }
            .compactMap(name)
        let names = authors.isEmpty ? creators.compactMap(name) : authors
        if names.isEmpty { return "Unknown author" }
        if names.count <= 2 { return names.joined(separator: ", ") }
        return "\(names[0]) et al."
    }

    private func load() async {
        guard let zotero = ZoteroAPI.current() else {
            error = "Not signed in."
            loading = false
            return
        }
        do {
            async let subs = zotero.subcollections(of: ref.key)
            async let papers = zotero.collectionItems(ref.key)
            subcollections = try await subs
            items = try await papers
        } catch {
            self.error = (error as? APIError)?.errorDescription
                ?? error.localizedDescription
        }
        loading = false
    }
}
