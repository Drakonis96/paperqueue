import Foundation
import SwiftUI

/// Drives authentication / data-source state.
/// - Web: paste a Zotero API key (works anywhere).
/// - Local (macOS): connect to Zotero desktop's local API (no key).
@MainActor
final class AuthManager: ObservableObject {
    enum State: Equatable {
        case unknown
        case signedOut
        case signedIn(username: String?)
        case error(String)
    }

    @Published private(set) var state: State = .unknown
    @Published var isWorking = false

    var isSignedIn: Bool {
        if case .signedIn = state { return true }
        return false
    }

    /// On launch: restore the previous data source.
    func bootstrap() async {
        switch AppConfig.dataSource {
        case .local:
            state = .signedIn(username: "Zotero on this Mac")
        case .web:
            if KeychainStore.apiKey() != nil, AppConfig.zoteroUserId != nil {
                state = .signedIn(username: AppConfig.zoteroUsername)
            } else {
                state = .signedOut
            }
        }
    }

    /// Validates a personal Zotero API key directly against Zotero (web mode).
    func signIn(withKey rawKey: String) async {
        let key = rawKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }

        isWorking = true
        defer { isWorking = false }

        do {
            let info = try await ZoteroAPI.verifyKey(key)
            guard info.canRead else {
                state = .error(
                    "This key has no library read access. Create one with read & write.")
                return
            }
            KeychainStore.saveAPIKey(key)
            AppConfig.zoteroUserId = String(info.userID)
            AppConfig.zoteroUsername = info.username
            AppConfig.dataSource = .web
            state = .signedIn(username: info.username)
        } catch {
            state = .error(
                (error as? APIError)?.errorDescription
                    ?? error.localizedDescription)
        }
    }

    /// True when a web API key is attached (so writes/cross-device sync work).
    /// In local mode this is the optional sync key; in web mode it's the
    /// account key.
    var hasWebSync: Bool {
        KeychainStore.apiKey() != nil && AppConfig.zoteroUserId != nil
    }

    /// Attaches a web API key while staying in local mode, so queue/read state
    /// is mirrored to Zotero and syncs to your other devices. Returns true on
    /// success.
    @discardableResult
    func attachWebKey(_ rawKey: String) async -> Bool {
        let key = rawKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return false }
        isWorking = true
        defer { isWorking = false }
        do {
            let info = try await ZoteroAPI.verifyKey(key)
            guard info.canWrite else {
                state = .error(
                    "This key can't write. Create one with read & write access.")
                return false
            }
            KeychainStore.saveAPIKey(key)
            AppConfig.zoteroUserId = String(info.userID)
            AppConfig.zoteroUsername = info.username
            return true
        } catch {
            state = .error(
                (error as? APIError)?.errorDescription
                    ?? error.localizedDescription)
            return false
        }
    }

    /// Removes the attached web sync key (local mode keeps working, but changes
    /// no longer sync to other devices).
    func detachWebKey() {
        KeychainStore.clear()
        AppConfig.zoteroUserId = nil
        AppConfig.zoteroUsername = nil
    }

    /// Connects to Zotero desktop's local API on this Mac (no key needed).
    func signInLocal() async {
        isWorking = true
        defer { isWorking = false }

        guard await ZoteroAPI.localReachable() else {
            state = .error(
                "Couldn't reach Zotero on this Mac. Make sure Zotero is open.")
            return
        }
        AppConfig.dataSource = .local
        state = .signedIn(username: "Zotero on this Mac")
    }

    func signOut() async {
        isWorking = true
        defer { isWorking = false }
        KeychainStore.clear()
        AppConfig.clearIdentity()
        state = .signedOut
    }
}
