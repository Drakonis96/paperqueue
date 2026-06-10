import SwiftUI

/// Sheet that gathers all Library filters in one place. Status and collection
/// are simple pickers; author / tag / year are searchable multi-select lists
/// (each with its own search bar) since libraries can have many of each.
struct LibraryFiltersView: View {
    @Environment(\.dismiss) private var dismiss

    @Binding var status: LibraryFilter
    @Binding var selectedCollection: String?
    @Binding var selectedAuthors: Set<String>
    @Binding var selectedTags: Set<String>
    @Binding var selectedYears: Set<String>

    let collections: [ZoteroCollection]
    let authors: [String]
    let tags: [String]
    let years: [String]

    private var activeCount: Int {
        var n = selectedAuthors.count + selectedTags.count + selectedYears.count
        if status != .all { n += 1 }
        if selectedCollection != nil { n += 1 }
        return n
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Status") {
                    Picker("Status", selection: $status) {
                        ForEach(LibraryFilter.allCases) { f in
                            Label(f.rawValue, systemImage: f.systemImage).tag(f)
                        }
                    }
                    .pickerStyle(.menu)

                    if !collections.isEmpty {
                        Picker("Collection", selection: $selectedCollection) {
                            Text("All collections").tag(String?.none)
                            ForEach(collections) { c in
                                Text(c.name).tag(String?.some(c.key))
                            }
                        }
                        .pickerStyle(.menu)
                    }
                }

                Section("Refine") {
                    filterLink(
                        "Authors", systemImage: "person.2",
                        options: authors, selection: $selectedAuthors)
                    filterLink(
                        "Tags", systemImage: "tag",
                        options: tags, selection: $selectedTags)
                    filterLink(
                        "Year", systemImage: "calendar",
                        options: years, selection: $selectedYears)
                }

                if activeCount > 0 {
                    Section {
                        Button("Clear all filters", role: .destructive) {
                            status = .all
                            selectedCollection = nil
                            selectedAuthors = []
                            selectedTags = []
                            selectedYears = []
                        }
                    }
                }
            }
            .navigationTitle("Filters")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func filterLink(
        _ title: String, systemImage: String,
        options: [String], selection: Binding<Set<String>>
    ) -> some View {
        NavigationLink {
            MultiSelectList(
                title: title, options: options, selection: selection)
        } label: {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                if selection.wrappedValue.isEmpty {
                    Text("Any").foregroundStyle(.secondary)
                } else {
                    Text("\(selection.wrappedValue.count)")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .disabled(options.isEmpty)
    }
}

/// A searchable multi-select list of strings.
struct MultiSelectList: View {
    let title: String
    let options: [String]
    @Binding var selection: Set<String>

    @State private var search = ""

    private var filtered: [String] {
        guard !search.isEmpty else { return options }
        let q = search.lowercased()
        return options.filter { $0.lowercased().contains(q) }
    }

    var body: some View {
        List {
            if !selection.isEmpty {
                Section {
                    Button("Clear selection") { selection.removeAll() }
                }
            }
            Section {
                if filtered.isEmpty {
                    Text("No matches").foregroundStyle(.secondary)
                }
                ForEach(filtered, id: \.self) { option in
                    Button {
                        toggle(option)
                    } label: {
                        HStack {
                            Text(option)
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                            Spacer()
                            if selection.contains(option) {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(Theme.accent)
                            }
                        }
                    }
                }
            } header: {
                Text("^[\(options.count) option](inflect: true)")
            }
        }
        .navigationTitle(title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .searchable(text: $search, prompt: "Search \(title.lowercased())")
    }

    private func toggle(_ option: String) {
        if selection.contains(option) {
            selection.remove(option)
        } else {
            selection.insert(option)
        }
    }
}
