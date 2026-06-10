import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var auth: AuthManager

    @State private var apiKey = ""
    @State private var showKey = false

    private let keysURL = URL(string: "https://www.zotero.org/settings/keys/new")!

    private var trimmedKey: String {
        apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                header
                instructions
                keyField

                if case let .error(message) = auth.state {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                connectButton

                localOption
            }
            .padding(28)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
    }

    private var localOption: some View {
        VStack(spacing: 10) {
            HStack {
                VStack { Divider() }
                Text("or").font(.caption).foregroundStyle(.secondary)
                VStack { Divider() }
            }
            Button {
                Task { await auth.signInLocal() }
            } label: {
                Label("Use Zotero on this Mac", systemImage: "desktopcomputer")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            Text("Reads your local Zotero library directly. Requires Zotero open on your Mac (same Wi-Fi for a real device). Add a Zotero key later in Settings to sync your queue with your iPhone/iPad.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            Image(systemName: "books.vertical.fill")
                .font(.system(size: 56))
                .foregroundStyle(Theme.accent)
            Text("PaperQueue")
                .font(.largeTitle.bold())
            Text("Read more of your Zotero library, with less friction.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 24)
    }

    private var instructions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Connect your Zotero account")
                .font(.headline)
            stepRow(1, "Open your Zotero key settings.")
            stepRow(2, "Create a new private key with library **read & write** access.")
            stepRow(3, "Copy the key and paste it below.")

            Link(destination: keysURL) {
                Label("Open Zotero key settings", systemImage: "safari")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .padding(.top, 4)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cardBackground, in: RoundedRectangle(
            cornerRadius: Theme.cornerRadius))
    }

    private func stepRow(_ n: Int, _ text: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(n)")
                .font(.caption.bold())
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Theme.accent, in: Circle())
            Text(text)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var keyField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Zotero API key")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Group {
                    if showKey {
                        TextField("Paste your key", text: $apiKey)
                    } else {
                        SecureField("Paste your key", text: $apiKey)
                    }
                }
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)

                Button {
                    showKey.toggle()
                } label: {
                    Image(systemName: showKey ? "eye.slash" : "eye")
                }
                .buttonStyle(.borderless)
                .help(showKey ? "Hide key" : "Show key")
            }
            Text("Kept securely in your device Keychain. PaperQueue talks straight to Zotero — no server.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private var connectButton: some View {
        Button {
            Task { await auth.signIn(withKey: trimmedKey) }
        } label: {
            if auth.isWorking {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                Text("Connect").frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(auth.isWorking || trimmedKey.isEmpty)
    }
}
