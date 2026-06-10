import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var store: QueueStore

    @State private var showSignOutConfirm = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    if case let .signedIn(username) = auth.state {
                        LabeledContent("Zotero", value: username ?? "Connected")
                    }
                    Button("Sync library now") {
                        Task { await store.syncLibrary() }
                    }
                    .disabled(store.isSyncing)
                }

                Section {
                    Button("Sign out", role: .destructive) {
                        showSignOutConfirm = true
                    }
                } footer: {
                    Text("PaperQueue \(appVersion) · talks directly to Zotero.")
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog(
                "Sign out of PaperQueue?",
                isPresented: $showSignOutConfirm,
                titleVisibility: .visible
            ) {
                Button("Sign out", role: .destructive) {
                    store.wipeCache()
                    Task { await auth.signOut() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your reading stats stay on this device. Your Zotero key is removed.")
            }
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"]
            as? String ?? "1.0"
        return "v\(version)"
    }
}
