import SwiftUI

/// Adds a paper to the Zotero library by DOI (metadata fetched from Crossref).
struct AddItemView: View {
    @EnvironmentObject private var store: QueueStore
    @Environment(\.dismiss) private var dismiss

    @State private var doi = ""
    @State private var isAdding = false
    @State private var error: String?

    private var trimmed: String {
        doi.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("10.1000/xyz123", text: $doi)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                        .autocorrectionDisabled()
                } header: {
                    Text("DOI")
                } footer: {
                    Text("We fetch the title, authors and journal from Crossref and add it to your Zotero library.")
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Section {
                    Button {
                        Task { await add() }
                    } label: {
                        if isAdding {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Add to library").frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(isAdding || trimmed.isEmpty)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Add Paper")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 280)
        #endif
    }

    private func add() async {
        isAdding = true
        error = nil
        let ok = await store.addByDOI(trimmed)
        isAdding = false
        if ok {
            dismiss()
        } else {
            error = store.lastError ?? "Could not add that paper."
            store.lastError = nil
        }
    }
}
