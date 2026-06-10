import Foundation
import SwiftData
import SwiftUI
import WidgetKit

/// Offline-first sync between the local SwiftData cache and Zotero.
///
/// Source of truth for queue state is a set of namespaced Zotero tags
/// (`pq:queue`, `pq:pos:<n>`, `pq:read`, `pq:skip`) written via the web API, so
/// the curated queue + order + read state sync across devices. In local mode
/// (Mac, read-only API) state is kept locally instead.
@MainActor
final class QueueStore: ObservableObject {
    static let queueTag = "pq:queue"
    static let readTag = "pq:read"
    static let skipTag = "pq:skip"
    static let posPrefix = "pq:pos:"
    static let posGap = 1024.0
    static let dayInterval: TimeInterval = 24 * 60 * 60

    /// Formats the read date stored in the `pq:read:<date>` tag.
    static let readDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    @Published var isSyncing = false
    @Published var lastError: String?
    @Published var isOffline = false
    @Published var syncSummary: String?

    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    private let nonPaperTypes: Set<String> = ["attachment", "note", "annotation"]

    /// Whether queue state is mirrored to Zotero tags (web) or kept local only.
    private var writesTags: Bool { AppConfig.dataSource == .web }

    // MARK: - Loading

    func initialLoad() async {
        await flushOutbox()
        let count = (try? context.fetchCount(FetchDescriptor<CachedPaper>())) ?? 0
        if count == 0 {
            await syncLibrary()
        } else {
            reevaluatePostpones()
            updateWidget()
        }
    }

    func refresh() async {
        await flushOutbox()
        reevaluatePostpones()
        updateWidget()
    }

    func syncLibrary() async {
        guard let zotero = ZoteroAPI.current() else {
            lastError = "Not signed in."
            return
        }
        isSyncing = true
        defer { isSyncing = false }
        await flushOutbox()

        do {
            let items = try await zotero.topItems()
            reconcile(items, tagsAuthoritative: writesTags)
            isOffline = false
            lastError = nil

            let total = (try? context.fetchCount(
                FetchDescriptor<CachedPaper>())) ?? 0
            let pending = (try? context.fetchCount(FetchDescriptor<CachedPaper>(
                predicate: #Predicate { $0.isPending }))) ?? 0
            syncSummary = "\(total) items in library · \(pending) in your queue."
        } catch let error as APIError where error.isOffline {
            isOffline = true
            lastError = "You appear to be offline."
        } catch {
            lastError = (error as? APIError)?.errorDescription
                ?? error.localizedDescription
        }
        updateWidget()
    }

    /// Reconciles fetched items into the cache.
    /// - tagsAuthoritative: when true (web), queue/read state is derived from
    ///   `pq:` tags. When false (local), only metadata is refreshed and local
    ///   queue decisions are preserved.
    private func reconcile(_ items: [ZoteroItem], tagsAuthoritative: Bool) {
        // `items` are top-level only. The PDF attachment key is resolved lazily
        // (in the detail view) so sync stays fast.
        let tops = items.filter {
            !nonPaperTypes.contains($0.data.itemType) && $0.data.parentItem == nil
        }
        let topKeys = Set(tops.map(\.data.key))

        let existing = (try? context.fetch(FetchDescriptor<CachedPaper>())) ?? []
        var byKey = Dictionary(
            existing.map { ($0.zoteroKey, $0) }, uniquingKeysWith: { a, _ in a })

        let now = Date()
        for item in tops {
            let d = item.data
            let tags = (d.tags ?? []).map(\.tag)

            let paper: CachedPaper
            if let p = byKey[d.key] {
                paper = p
            } else {
                paper = CachedPaper(
                    zoteroKey: d.key, zoteroVersion: d.version,
                    title: d.title ?? "(untitled)",
                    authors: authorNames(d.creators),
                    publicationTitle: d.publicationTitle, dateString: d.date,
                    doi: d.doi, urlString: d.url, tags: tags,
                    pdfAttachmentKey: nil, readStatus: "unread",
                    addedAt: d.dateAdded, sortPriority: 0)
                context.insert(paper)
                byKey[d.key] = paper
            }

            // Always refresh metadata (but preserve a lazily-resolved PDF key).
            paper.zoteroVersion = d.version
            paper.title = d.title ?? "(untitled)"
            paper.authors = authorNames(d.creators)
            paper.publicationTitle = d.publicationTitle
            paper.dateString = d.date
            paper.doi = d.doi
            paper.urlString = d.url
            paper.addedAt = d.dateAdded
            paper.collectionKeys = d.collections
            paper.tags = tags
            paper.updatedAt = now

            guard tagsAuthoritative else { continue }

            // Web mode: derive queue/read state from pq: tags.
            let read = isRead(tags)
            let skipped = tags.contains(Self.skipTag)
            let queued = tags.contains(Self.queueTag)
            paper.readStatus = read ? "read" : (skipped ? "skipped" : "unread")
            paper.readDate = read ? parseReadDate(tags) : nil
            paper.sortPriority = parsePos(tags) ?? .greatestFiniteMagnitude

            if read {
                paper.queueStatus = "read"
                paper.isPending = false
            } else if skipped {
                paper.queueStatus = "skipped"
                paper.isPending = false
            } else if queued {
                let postponedActive = paper.queueStatus == "postponed"
                    && (paper.postponedUntil ?? .distantPast) > now
                if postponedActive {
                    paper.isPending = false
                } else {
                    paper.queueStatus = "pending"
                    paper.postponedUntil = nil
                    paper.isPending = true
                }
            } else {
                paper.queueStatus = nil
                paper.isPending = false
            }
        }

        for paper in existing where !topKeys.contains(paper.zoteroKey) {
            context.delete(paper)
        }
        try? context.save()
    }

    private func reevaluatePostpones() {
        let now = Date()
        let descriptor = FetchDescriptor<CachedPaper>(
            predicate: #Predicate { $0.queueStatus == "postponed" })
        guard let postponed = try? context.fetch(descriptor) else { return }
        var changed = false
        for paper in postponed
        where (paper.postponedUntil ?? .distantPast) <= now {
            paper.queueStatus = "pending"
            paper.postponedUntil = nil
            paper.isPending = true
            changed = true
        }
        if changed { try? context.save() }
    }

    // MARK: - Mutations

    func addToQueue(_ paper: CachedPaper) {
        let pos = nextPosition()
        paper.readStatus = "unread"
        paper.queueStatus = "pending"
        paper.postponedUntil = nil
        paper.readDate = nil
        paper.isPending = true
        paper.sortPriority = pos
        applyState(paper, queued: true, read: false, skipped: false, pos: pos)
    }

    func markRead(_ paper: CachedPaper) {
        paper.readStatus = "read"
        paper.queueStatus = "read"
        paper.postponedUntil = nil
        paper.readDate = Date()
        paper.isPending = false
        applyState(paper, queued: false, read: true, skipped: false, pos: nil)
    }

    func skip(_ paper: CachedPaper) {
        paper.readStatus = "skipped"
        paper.queueStatus = "skipped"
        paper.readDate = nil
        paper.isPending = false
        applyState(paper, queued: false, read: false, skipped: true, pos: nil)
    }

    func reset(_ paper: CachedPaper) {
        addToQueue(paper)
    }

    /// Takes a paper out of the queue without marking it read (back to library).
    func removeFromQueue(_ paper: CachedPaper) {
        clearLists(paper)
    }

    /// Un-marks a read/skipped paper (removes it from history, back to library).
    func removeFromHistory(_ paper: CachedPaper) {
        clearLists(paper)
    }

    /// Clears all pq: state: a plain (unread, not queued) library item.
    private func clearLists(_ paper: CachedPaper) {
        paper.readStatus = "unread"
        paper.queueStatus = nil
        paper.postponedUntil = nil
        paper.readDate = nil
        paper.isPending = false
        applyState(paper, queued: false, read: false, skipped: false, pos: nil)
    }

    /// Postpone is a local-only UX action; it keeps the `pq:queue` tag.
    func postpone(_ paper: CachedPaper, days: Int = 1) {
        paper.queueStatus = "postponed"
        paper.postponedUntil = Date()
            .addingTimeInterval(Double(days) * Self.dayInterval)
        paper.isPending = false
        paper.updatedAt = Date()
        try? context.save()
        updateWidget()
    }

    /// Adds a Zotero item picked from a collection to the queue.
    func enqueue(_ item: ZoteroItem) {
        let d = item.data
        let key = d.key
        let descriptor = FetchDescriptor<CachedPaper>(
            predicate: #Predicate { $0.zoteroKey == key })
        let paper: CachedPaper
        if let existing = try? context.fetch(descriptor).first {
            paper = existing
        } else {
            paper = CachedPaper(
                zoteroKey: d.key, zoteroVersion: d.version,
                title: d.title ?? "(untitled)",
                authors: authorNames(d.creators),
                publicationTitle: d.publicationTitle, dateString: d.date,
                doi: d.doi, urlString: d.url, tags: (d.tags ?? []).map(\.tag),
                pdfAttachmentKey: nil, readStatus: "unread",
                addedAt: d.dateAdded, sortPriority: 0)
            context.insert(paper)
        }
        addToQueue(paper)
    }

    /// Clears the entire local cache (used on sign-out / account switch).
    func wipeCache() {
        try? context.delete(model: CachedPaper.self)
        try? context.delete(model: OutboxAction.self)
        try? context.delete(model: ReadingSessionLocal.self)
        try? context.save()
        syncSummary = nil
        updateWidget()
    }

    /// Adds a paper to the Zotero library by DOI (metadata via Crossref), then
    /// resyncs. Returns true on success.
    func addByDOI(_ doi: String) async -> Bool {
        guard let zotero = ZoteroAPI.current() else { return false }
        isSyncing = true
        defer { isSyncing = false }
        do {
            let item = try await CrossrefClient.zoteroItem(forDOI: doi)
            try await zotero.createItems([item])
        } catch {
            lastError = (error as? APIError)?.errorDescription
                ?? error.localizedDescription
            return false
        }
        await syncLibrary()
        return lastError == nil
    }

    func isQueued(_ zoteroKey: String) -> Bool {
        let descriptor = FetchDescriptor<CachedPaper>(
            predicate: #Predicate { $0.zoteroKey == zoteroKey && $0.isPending })
        return ((try? context.fetchCount(descriptor)) ?? 0) > 0
    }

    /// Persists a manual reading order, renumbering with gaps and writing the
    /// `pq:pos` tag for items whose position changed (web mode).
    func reorderPending(_ ordered: [CachedPaper]) {
        var wroteAny = false
        for (index, paper) in ordered.enumerated() {
            let newPos = Double(index + 1) * Self.posGap
            guard paper.sortPriority != newPos else { continue }
            paper.sortPriority = newPos
            if writesTags {
                let tags = desiredTags(
                    paper.tags, queued: true, read: false, skipped: false,
                    pos: newPos)
                paper.tags = tags
                context.insert(OutboxAction(paperKey: paper.zoteroKey, tags: tags))
                wroteAny = true
            }
        }
        try? context.save()
        if wroteAny { Task { await flushOutbox() } }
        updateWidget()
    }

    /// Applies the local state change and (web mode) queues the matching tag set.
    private func applyState(
        _ paper: CachedPaper, queued: Bool, read: Bool, skipped: Bool,
        pos: Double?
    ) {
        let tags = desiredTags(
            paper.tags, queued: queued, read: read, skipped: skipped, pos: pos)
        paper.tags = tags
        paper.updatedAt = Date()
        try? context.save()
        if writesTags {
            context.insert(OutboxAction(paperKey: paper.zoteroKey, tags: tags))
            try? context.save()
            Task { await flushOutbox() }
        }
        updateWidget()
    }

    func flushOutbox() async {
        guard writesTags, let zotero = ZoteroAPI.current() else { return }
        let descriptor = FetchDescriptor<OutboxAction>(
            sortBy: [SortDescriptor(\.createdAt)])
        guard let actions = try? context.fetch(descriptor), !actions.isEmpty
        else { return }

        for action in actions {
            do {
                try await zotero.setTags(
                    itemKey: action.paperKey, tags: action.tags)
                context.delete(action)
                try? context.save()
            } catch let error as APIError where error.isOffline {
                isOffline = true
                return
            } catch {
                context.delete(action)
                try? context.save()
            }
        }
        isOffline = false
    }

    // MARK: - Helpers

    private func desiredTags(
        _ base: [String], queued: Bool, read: Bool, skipped: Bool, pos: Double?
    ) -> [String] {
        var tags = base.filter { !$0.hasPrefix("pq:") }
        if queued {
            tags.append(Self.queueTag)
            if let pos { tags.append(Self.posPrefix + String(Int(pos))) }
        }
        if read {
            tags.append(Self.readTag + ":"
                + Self.readDateFormatter.string(from: Date()))
        }
        if skipped { tags.append(Self.skipTag) }
        return tags
    }

    private func isRead(_ tags: [String]) -> Bool {
        tags.contains { $0 == Self.readTag || $0.hasPrefix(Self.readTag + ":") }
    }

    private func parseReadDate(_ tags: [String]) -> Date? {
        for t in tags where t.hasPrefix(Self.readTag + ":") {
            return Self.readDateFormatter.date(
                from: String(t.dropFirst(Self.readTag.count + 1)))
        }
        return nil
    }

    private func parsePos(_ tags: [String]) -> Double? {
        for tag in tags where tag.hasPrefix(Self.posPrefix) {
            return Double(tag.dropFirst(Self.posPrefix.count))
        }
        return nil
    }

    private func nextPosition() -> Double {
        let descriptor = FetchDescriptor<CachedPaper>(
            predicate: #Predicate { $0.isPending })
        let pending = (try? context.fetch(descriptor)) ?? []
        let maxPos = pending.map(\.sortPriority)
            .filter { $0 < .greatestFiniteMagnitude }
            .max() ?? 0
        return maxPos + Self.posGap
    }

    private func authorNames(_ creators: [ZoteroCreator]?) -> [String] {
        (creators ?? []).map { c in
            if let name = c.name { return name }
            if let last = c.lastName, let first = c.firstName {
                return "\(last), \(first)"
            }
            return c.lastName ?? c.firstName ?? ""
        }
    }

    // MARK: - Widget

    func updateWidget() {
        let descriptor = FetchDescriptor<CachedPaper>(
            predicate: #Predicate { $0.isPending },
            sortBy: [SortDescriptor(\.sortPriority), SortDescriptor(\.zoteroKey)])
        let pending = (try? context.fetch(descriptor)) ?? []
        let next = pending.first
        let snapshot = WidgetSnapshot(
            pendingCount: pending.count,
            nextTitle: next?.title,
            nextAuthors: next?.authorLine,
            nextPaperKey: next?.zoteroKey,
            updatedAt: Date())
        WidgetBridge.write(snapshot)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
