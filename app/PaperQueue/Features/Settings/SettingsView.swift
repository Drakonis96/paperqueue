import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var store: QueueStore

    @State private var showSignOutConfirm = false
    @State private var syncKey = ""
    @State private var attaching = false
    @State private var attachError: String?

    private var isLocal: Bool { AppConfig.dataSource == .local }

    private let keysURL = URL(string: "https://www.zotero.org/settings/keys/new")!

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

                crossDeviceSyncSection

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

    /// Lets a Mac running in local mode attach a Zotero web API key so its
    /// queue/read changes sync to other devices (the local API is read-only, so
    /// writes have to go through the web API).
    @ViewBuilder
    private var crossDeviceSyncSection: some View {
        if isLocal {
            Section {
                if auth.hasWebSync {
                    Label("Syncing with Zotero (web)", systemImage: "checkmark.icloud")
                        .foregroundStyle(.green)
                    if let user = AppConfig.zoteroUsername {
                        LabeledContent("Account", value: user)
                    }
                    Button("Turn off sync", role: .destructive) {
                        auth.detachWebKey()
                        Task { await store.syncLibrary() }
                    }
                } else {
                    SecureField("Zotero API key", text: $syncKey)
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                        .autocorrectionDisabled()
                    if let attachError {
                        Text(attachError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                    Button {
                        Task { await enableSync() }
                    } label: {
                        if attaching {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Enable sync")
                        }
                    }
                    .disabled(attaching || syncKey.trimmingCharacters(
                        in: .whitespacesAndNewlines).isEmpty)
                    Link(destination: keysURL) {
                        Label("Create a key (read & write)", systemImage: "key")
                    }
                }
            } header: {
                Text("Cross-device sync")
            } footer: {
                Text(auth.hasWebSync
                    ? "Changes you make on this Mac sync to your phone and other devices through Zotero."
                    : "Reading on this Mac is local. Add a Zotero API key to mirror your queue and read state to Zotero, so the iPhone/iPad app stays in sync.")
            }
        } else {
            Section {
                Label("Syncs across your devices", systemImage: "checkmark.icloud")
                    .foregroundStyle(.green)
            } footer: {
                Text("Your queue and read state sync through Zotero tags, so every device using PaperQueue stays up to date.")
            }
        }
    }

    private func enableSync() async {
        attaching = true
        attachError = nil
        let ok = await auth.attachWebKey(syncKey)
        attaching = false
        if ok {
            syncKey = ""
            await store.syncLibrary()
        } else if case let .error(message) = auth.state {
            attachError = message
        } else {
            attachError = "Couldn't enable sync."
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"]
            as? String ?? "1.0"
        return "v\(version)"
    }
}
