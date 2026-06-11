import Foundation

// MARK: - Wire types (Zotero API v3 — same shape for web and local)

struct ZoteroCreator: Codable, Hashable {
    let creatorType: String
    let firstName: String?
    let lastName: String?
    let name: String?
}

struct ZoteroTag: Codable, Hashable {
    let tag: String
}

struct ZoteroItemData: Codable {
    let key: String
    let version: Int
    let itemType: String
    let title: String?
    let creators: [ZoteroCreator]?
    let abstractNote: String?
    let publicationTitle: String?
    let date: String?
    let doi: String?
    let url: String?
    let tags: [ZoteroTag]?
    let dateAdded: String?
    let parentItem: String?
    let contentType: String?
    let collections: [String]?

    enum CodingKeys: String, CodingKey {
        case key, version, itemType, title, creators, abstractNote
        case publicationTitle, date
        case doi = "DOI"
        case url, tags, dateAdded, parentItem, contentType, collections
    }
}

struct ZoteroItem: Codable {
    let key: String
    let version: Int
    let data: ZoteroItemData
}

struct ZoteroCollection: Codable, Identifiable {
    let key: String
    let version: Int
    let data: CollectionData

    var id: String { key }
    var name: String { data.name }

    struct CollectionData: Codable {
        let key: String
        let name: String
    }
}

struct ZoteroKeyInfo: Codable {
    let userID: Int
    let username: String?
    let access: Access?

    struct Access: Codable {
        let user: UserAccess?
        struct UserAccess: Codable {
            let library: Bool?
            let write: Bool?
        }
    }

    var canRead: Bool { access?.user?.library ?? false }
    var canWrite: Bool { access?.user?.write ?? false }
}

// MARK: - Data source

enum ZoteroSource: String, Codable {
    case web    // api.zotero.org, needs an API key
    case local  // Zotero desktop's local API on this machine
}

// MARK: - Client

/// Talks to the Zotero API v3 — either the web API (api.zotero.org, needs a key)
/// or the local desktop API (localhost:23119, no key, has local files).
struct ZoteroAPI {
    static let webBase = URL(string: "https://api.zotero.org")!
    // 127.0.0.1 (not "localhost"): Zotero's local API binds IPv4 only, and the
    // iOS Simulator resolves "localhost" to ::1 (IPv6) and fails to connect.
    static let localBase = URL(string: "http://127.0.0.1:23119/api")!

    let baseURL: URL
    /// e.g. "users/12114468" (web) or "users/0" (local alias).
    let libraryPath: String
    let apiKey: String?

    /// Resolves the active *read* client from the chosen data source + creds.
    static func current() -> ZoteroAPI? {
        switch AppConfig.dataSource {
        case .local:
            return ZoteroAPI(
                baseURL: localBase, libraryPath: "users/0", apiKey: nil)
        case .web:
            return webWriteClient()
        }
    }

    /// A client that can *write* to Zotero (always the web API, which accepts
    /// PATCH/POST — the local desktop API is read-only). Available whenever a
    /// web API key + user id are stored, even in local mode, so the Mac can
    /// mirror queue/read state to the cloud and keep other devices in sync.
    static func webWriteClient() -> ZoteroAPI? {
        guard let key = KeychainStore.apiKey(),
              let uid = AppConfig.zoteroUserId
        else { return nil }
        return ZoteroAPI(
            baseURL: webBase, libraryPath: "users/\(uid)", apiKey: key)
    }

    // MARK: Sign-in helpers

    /// Validates a web API key (web mode only).
    static func verifyKey(_ apiKey: String) async throws -> ZoteroKeyInfo {
        var req = URLRequest(
            url: webBase.appendingPathComponent("keys/current"))
        req.setValue("3", forHTTPHeaderField: "Zotero-API-Version")
        req.setValue(apiKey, forHTTPHeaderField: "Zotero-API-Key")
        let (data, response) = try await send(req)
        guard response.statusCode == 200 else {
            throw APIError.server(
                status: response.statusCode,
                message: "Zotero rejected that API key. Check you copied it correctly.")
        }
        do {
            return try JSONDecoder().decode(ZoteroKeyInfo.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    /// True if Zotero desktop's local API answers on this machine.
    static func localReachable() async -> Bool {
        var req = URLRequest(url: localBase.appendingPathComponent("users/0/items/top"))
        req.httpMethod = "GET"
        req.setValue("3", forHTTPHeaderField: "Zotero-API-Version")
        req.timeoutInterval = 4
        guard let (_, response) = try? await send(req) else { return false }
        return response.statusCode == 200
    }

    // MARK: Reads

    /// Every top-level library item — books, journal articles, theses, etc.,
    /// plus standalone (parent-less) attachments and notes. Only a paper's
    /// *child* attachments/notes/annotations are left out (the endpoint already
    /// excludes them). Pages are fetched concurrently so a large library loads
    /// fast. `onProgress` reports a 0…1 fraction (for a progress bar).
    func topItems(
        onProgress: (@Sendable (Double) -> Void)? = nil
    ) async throws -> [ZoteroItem] {
        try await paginatedItems(path: "items/top", onProgress: onProgress)
    }

    /// Child items of an item (used to find a PDF attachment on demand).
    func children(of itemKey: String) async throws -> [ZoteroItem] {
        try await paginatedItems(path: "items/\(itemKey)/children")
    }

    func topCollections() async throws -> [ZoteroCollection] {
        try await collections(path: "collections/top")
    }

    /// Every collection in the library (flat) — for the Library collection filter.
    func allCollections() async throws -> [ZoteroCollection] {
        try await collections(path: "collections")
    }

    func subcollections(of key: String) async throws -> [ZoteroCollection] {
        try await collections(path: "collections/\(key)/collections")
    }

    func collectionItems(_ key: String) async throws -> [ZoteroItem] {
        try await paginatedItems(path: "collections/\(key)/items/top")
    }

    func fileData(itemKey: String) async throws -> Data {
        let (data, response) = try await Self.send(
            authorized(libURL("items/\(itemKey)/file")))
        guard (200..<300).contains(response.statusCode) else {
            throw APIError.server(status: response.statusCode, message: nil)
        }
        return data
    }

    // MARK: Writes

    func createItems(_ items: [[String: Any]]) async throws {
        var req = authorized(libURL("items"), method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: items)

        let (data, response) = try await Self.send(req)
        guard response.statusCode == 200 else {
            if response.statusCode == 403 {
                throw APIError.server(
                    status: 403,
                    message: "Your key can't write. Use a write-enabled key.")
            }
            throw APIError.server(status: response.statusCode, message: nil)
        }
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let failed = obj["failed"] as? [String: Any], !failed.isEmpty {
            let reason = (failed.values.first as? [String: Any])?["message"]
                as? String
            throw APIError.server(
                status: 400, message: reason ?? "Zotero rejected the item.")
        }
    }

    func setTags(itemKey: String, tags: [String]) async throws {
        let (data, response) = try await Self.send(
            authorized(libURL("items/\(itemKey)")))
        guard response.statusCode == 200 else {
            throw APIError.server(status: response.statusCode, message: nil)
        }
        let item = try JSONDecoder().decode(ZoteroItem.self, from: data)

        var patch = authorized(libURL("items/\(itemKey)"), method: "PATCH")
        patch.setValue("application/json", forHTTPHeaderField: "Content-Type")
        patch.setValue(
            "\(item.data.version)",
            forHTTPHeaderField: "If-Unmodified-Since-Version")
        patch.httpBody = try JSONSerialization.data(
            withJSONObject: ["tags": tags.map { ["tag": $0] }])

        let (_, presponse) = try await Self.send(patch)
        guard presponse.statusCode == 204 else {
            throw APIError.server(status: presponse.statusCode, message: nil)
        }
    }

    // MARK: - Internals

    /// Largest page Zotero serves in one request.
    private static let pageLimit = 100
    /// How many page requests to keep in flight at once. Zotero tolerates a
    /// handful of concurrent reads; this is the sweet spot between speed and
    /// staying well under its rate limits.
    private static let maxConcurrentPages = 5

    /// Fetches a paginated item list. The first page is fetched to learn the
    /// total count, then the remaining pages are requested concurrently (in
    /// bounded batches) instead of one-at-a-time — a big speedup for large
    /// libraries. Results are returned in their original order.
    private func paginatedItems(
        path: String, onProgress: (@Sendable (Double) -> Void)? = nil
    ) async throws -> [ZoteroItem] {
        let limit = Self.pageLimit

        // First page also tells us how many items there are in total.
        let (firstBatch, total) = try await fetchPage(path: path, start: 0, limit: limit)
        var loaded = firstBatch.count
        onProgress?(total > 0 ? min(Double(loaded) / Double(total), 1) : 1)

        if loaded >= total || firstBatch.isEmpty {
            onProgress?(1)
            return firstBatch
        }

        // Remaining page offsets, fetched concurrently in bounded windows.
        let starts = stride(from: limit, to: total, by: limit).map { $0 }
        var pages: [Int: [ZoteroItem]] = [0: firstBatch]

        var index = 0
        while index < starts.count {
            let window = starts[index..<min(index + Self.maxConcurrentPages, starts.count)]
            try await withThrowingTaskGroup(of: (Int, [ZoteroItem]).self) { group in
                for start in window {
                    group.addTask {
                        let (batch, _) = try await self.fetchPage(
                            path: path, start: start, limit: limit)
                        return (start, batch)
                    }
                }
                for try await (start, batch) in group {
                    pages[start] = batch
                    loaded += batch.count
                    if let onProgress, total > 0 {
                        onProgress(min(Double(loaded) / Double(total), 1))
                    }
                }
            }
            index += Self.maxConcurrentPages
        }

        onProgress?(1)
        return pages.keys.sorted().flatMap { pages[$0] ?? [] }
    }

    /// Fetches a single page of items and reports the library's total count
    /// (from the `Total-Results` header).
    private func fetchPage(
        path: String, start: Int, limit: Int
    ) async throws -> (items: [ZoteroItem], total: Int) {
        var comps = URLComponents(
            url: libURL(path), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "include", value: "data"),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "start", value: "\(start)"),
        ]
        let (data, response) = try await Self.send(authorized(comps.url!))
        guard response.statusCode == 200 else {
            throw APIError.server(status: response.statusCode, message: nil)
        }
        let batch: [ZoteroItem]
        do {
            batch = try JSONDecoder().decode([ZoteroItem].self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
        let total = Int(
            response.value(forHTTPHeaderField: "Total-Results") ?? "")
            ?? (start + batch.count)
        return (batch, total)
    }

    private func collections(path: String) async throws -> [ZoteroCollection] {
        let (data, response) = try await Self.send(authorized(libURL(path)))
        guard response.statusCode == 200 else {
            throw APIError.server(status: response.statusCode, message: nil)
        }
        do {
            return try JSONDecoder().decode([ZoteroCollection].self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func libURL(_ suffix: String) -> URL {
        baseURL.appendingPathComponent("\(libraryPath)/\(suffix)")
    }

    private func authorized(_ url: URL, method: String = "GET") -> URLRequest {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("3", forHTTPHeaderField: "Zotero-API-Version")
        if let apiKey {
            req.setValue(apiKey, forHTTPHeaderField: "Zotero-API-Key")
        }
        return req
    }

    private static func send(
        _ req: URLRequest
    ) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            return (data, http)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport(error)
        }
    }
}
