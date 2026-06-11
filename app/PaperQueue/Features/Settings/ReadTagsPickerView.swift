import SwiftUI

/// Lets the user choose one or more existing Zotero tags (or type a new one)
/// to be applied automatically when a paper is marked read. Search filters the
/// full tag list; tapping toggles selection.
struct ReadTagsPickerView: View {
    let allTags: [String]
    @Binding var selected: [String]

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var trimmedSearch: String {
        search.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var filteredTags: [String] {
        guard !trimmedSearch.isEmpty else { return allTags }
        return allTags.filter { $0.localizedCaseInsensitiveContains(trimmedSearch) }
    }

    /// True when the typed text isn't already an existing or selected tag, so we
    /// can offer to add it as a brand-new tag.
    private var canAddTyped: Bool {
        guard !trimmedSearch.isEmpty else { return false }
        let exists = allTags.contains { $0.caseInsensitiveCompare(trimmedSearch) == .orderedSame }
        return !exists && !isSelected(trimmedSearch)
    }

    var body: some View {
        NavigationStack {
            List {
                if !selected.isEmpty {
                    Section("Applied on read") {
                        ForEach(selected, id: \.self) { tag in
                            Button { toggle(tag) } label: {
                                HStack {
                                    Label(tag, systemImage: "checkmark.circle.fill")
                                        .foregroundStyle(.green)
                                    Spacer()
                                    Image(systemName: "minus.circle")
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                if canAddTyped {
                    Section {
                        Button {
                            addTag(trimmedSearch)
                        } label: {
                            Label("Add “\(trimmedSearch)”", systemImage: "plus.circle")
                        }
                    }
                }

                Section("Library tags") {
                    if filteredTags.isEmpty {
                        Text(allTags.isEmpty
                            ? "Sync your library to load its tags."
                            : "No tags match “\(trimmedSearch)”.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(filteredTags, id: \.self) { tag in
                            Button { toggle(tag) } label: {
                                HStack {
                                    Text(tag).foregroundStyle(.primary)
                                    Spacer()
                                    if isSelected(tag) {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(Theme.accent)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "Search or add a tag")
            .navigationTitle("Tags on read")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        // macOS sheets don't auto-size, so the List would collapse to zero
        // height and show nothing — give it an explicit, resizable frame.
        #if os(macOS)
        .frame(minWidth: 420, idealWidth: 460, minHeight: 480, idealHeight: 560)
        #endif
    }

    private func isSelected(_ tag: String) -> Bool {
        selected.contains { $0.caseInsensitiveCompare(tag) == .orderedSame }
    }

    private func toggle(_ tag: String) {
        if let idx = selected.firstIndex(where: {
            $0.caseInsensitiveCompare(tag) == .orderedSame
        }) {
            selected.remove(at: idx)
        } else {
            selected.append(tag)
        }
    }

    private func addTag(_ tag: String) {
        guard !isSelected(tag) else { return }
        selected.append(tag)
        search = ""
    }
}
