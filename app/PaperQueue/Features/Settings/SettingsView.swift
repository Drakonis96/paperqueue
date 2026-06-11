import SwiftData
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var auth: AuthManager
    @EnvironmentObject private var store: QueueStore

    @Query private var papers: [CachedPaper]

    @State private var showSignOutConfirm = false
    @State private var syncKey = ""
    @State private var attaching = false
    @State private var attachError: String?

    @AppStorage("dailyGoal") private var dailyGoal: Int = 1
    @AppStorage("reminderEnabled") private var reminderEnabled: Bool = false
    @State private var reminderTime: Date = SettingsView.initialReminderTime()
    @State private var notifDenied = false

    @State private var extraReadTags: [String] = AppConfig.readExtraTags
    @State private var showingTagPicker = false

    private var isLocal: Bool { AppConfig.dataSource == .local }

    /// Distinct user tags across the library (excludes pq: state and hidden `_`).
    private var allTags: [String] {
        Set(papers.flatMap(\.tags))
            .filter { !$0.hasPrefix("pq:") && !$0.hasPrefix("_") }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

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

                readingGoalSection

                readTagsSection

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
            .sheet(isPresented: $showingTagPicker) {
                ReadTagsPickerView(allTags: allTags, selected: $extraReadTags)
            }
            .onChange(of: extraReadTags) { _, newValue in
                AppConfig.readExtraTags = newValue
            }
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

    /// Daily goal + reminder controls that drive the gamification features.
    @ViewBuilder
    private var readingGoalSection: some View {
        Section {
            Stepper(value: $dailyGoal, in: 1...20) {
                Label {
                    Text("Daily goal: \(dailyGoal) \(dailyGoal == 1 ? "paper" : "papers")")
                } icon: {
                    Image(systemName: "target").foregroundStyle(.green)
                }
            }
            .onChange(of: dailyGoal) { _, _ in NotificationManager.sync() }

            Toggle(isOn: reminderBinding) {
                Label {
                    Text("Daily reminder")
                } icon: {
                    Image(systemName: "bell.badge").foregroundStyle(.orange)
                }
            }

            if reminderEnabled {
                DatePicker(
                    selection: $reminderTime,
                    displayedComponents: .hourAndMinute
                ) {
                    Label {
                        Text("Reminder time")
                    } icon: {
                        Image(systemName: "clock").foregroundStyle(.blue)
                    }
                }
                .onChange(of: reminderTime) { _, newValue in
                    let comps = Calendar.current.dateComponents(
                        [.hour, .minute], from: newValue)
                    AppConfig.reminderHour = comps.hour ?? 19
                    AppConfig.reminderMinute = comps.minute ?? 0
                    NotificationManager.sync()
                }
            }

            if notifDenied {
                Text("Notifications are turned off for PaperQueue. Enable them in Settings to get reminders.")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Reading goal")
        } footer: {
            Text("Hit your daily goal to build a streak. The Stats tab colours each day green when you reach it.")
        }
    }

    /// Toggle binding that requests notification permission when switched on and
    /// reflects denial back into the UI.
    private var reminderBinding: Binding<Bool> {
        Binding(
            get: { reminderEnabled },
            set: { wantOn in
                if wantOn {
                    Task { @MainActor in
                        let granted = await NotificationManager.enableReminder()
                        reminderEnabled = granted
                        notifDenied = !granted
                    }
                } else {
                    reminderEnabled = false
                    AppConfig.reminderEnabled = false
                    notifDenied = false
                    NotificationManager.sync()
                }
            })
    }

    private static func initialReminderTime() -> Date {
        var comps = DateComponents()
        comps.hour = AppConfig.reminderHour
        comps.minute = AppConfig.reminderMinute
        return Calendar.current.date(from: comps) ?? Date()
    }

    /// Optional extra tags applied to a paper when it's marked read.
    @ViewBuilder
    private var readTagsSection: some View {
        Section {
            if extraReadTags.isEmpty {
                Button {
                    showingTagPicker = true
                } label: {
                    Label("Add tags on read…", systemImage: "tag")
                }
            } else {
                ForEach(extraReadTags, id: \.self) { tag in
                    HStack {
                        Label(tag, systemImage: "tag.fill")
                            .foregroundStyle(.primary)
                        Spacer()
                        Button {
                            extraReadTags.removeAll {
                                $0.caseInsensitiveCompare(tag) == .orderedSame
                            }
                        } label: {
                            Image(systemName: "minus.circle.fill")
                                .foregroundStyle(.red)
                        }
                        .buttonStyle(.borderless)
                    }
                }
                Button {
                    showingTagPicker = true
                } label: {
                    Label("Edit tags", systemImage: "tag")
                }
            }
        } header: {
            Text("Tags on read")
        } footer: {
            Text("When you mark a paper read, these Zotero tags are added alongside PaperQueue's own tag. Optional.")
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
