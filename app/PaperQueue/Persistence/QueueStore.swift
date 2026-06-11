import Foundation
import SwiftData
import SwiftUI
import WidgetKit

/// Offline-first sync between the local SwiftData cache and Zotero.
///
/// Source of truth for queue state is a set of namespaced Zotero tags
/// (`pq:queue`, `pq:qname:<name>`, `pq:pos:<n>`, `pq:read`, `pq:skip`) written
/// via the web API, so the curated queue(s) + order + read state sync across
/// devices. The local desktop API is read-only, so even in local mode (Mac) we
/// *write* through the web API when an API key is attached — this keeps a Mac
/// reading locally and a phone using the web API in sync through Zotero itself.
@MainActor
final class QueueStore: ObservableObject {
    static let queueTag = "pq:queue"
    static let readTag = "pq:read"
    static let skipTag = "pq:skip"
    static let posPrefix = "pq:pos:"
    static let qnamePrefix = "pq:qname:"
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
    /// 0…1 fraction while fetching the library (nil when not fetching).
    @Published var syncProgress: Double?

    /// All selectable queues (Default first), and which one the Queue tab shows.
    @Published var availableQueues: [String]
    @Published var activeQueue: String

    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
        self.availableQueues = AppConfig.allQueueNames
        let active = AppConfig.activeQueueName
        self.activeQueue = AppConfig.allQueueNames.contains(active)
            ? active : AppConfig.defaultQueueName
    }

    /// Whether queue state is mirrored to Zotero tags. True whenever a web API
    /// key is available (web mode, or local mode with an attached key).
    private var writesTags: Bool { ZoteroAPI.webWriteClient() != nil }

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
        lastError = nil
        syncProgress = 0
        syncSummary = "Fetching library…"
        defer {
            isSyncing = false
            syncProgress = nil
            updateWidget()
        }
        await flushOutbox()

        do {
            let items = try await zotero.topItems { fraction in
                Task { @MainActor in self.syncProgress = fraction }
            }
            reconcile(items, tagsAuthoritative: writesTags)
            isOffline = false
            lastError = nil

            let total = (try? context.fetchCount(
                FetchDescriptor<CachedPaper>())) ?? 0
            let pending = (try? context.fetchCount(FetchDescriptor<CachedPaper>(
                predicate: #Predicate { $0.isPending }))) ?? 0
            syncSummary = "\(total) items in library · \(pending) in your queue."
        } catch is CancellationError {
            // Pull-to-refresh dismissed before the call finished — ignore.
            isOffline = false
            lastError = nil
        } catch let error as APIError where error.isCancelled {
            isOffline = false
            lastError = nil
        } catch let error as APIError where error.isOffline {
            isOffline = true
            lastError = "You appear to be offline."
        } catch {
            lastError = (error as? APIError)?.errorDescription
                ?? error.localizedDescription
        }
    }

    /// Reconciles fetched items into the cache.
    /// - tagsAuthoritative: when true, queue/read state is derived from `pq:`
    ///   tags. When false (local with no web key), only metadata is refreshed
    ///   and local queue decisions are preserved.
    private func reconcile(_ items: [ZoteroItem], tagsAuthoritative: Bool) {
        // Keep every top-level library item — including standalone (parent-less)
        // attachments and notes, which are real entries the user sees in Zotero.
        // Only a paper's *child* PDF/note/annotation is excluded (parentItem set);
        // `items/top` already drops those, so this guard is belt-and-suspenders.
        // For a top-level PDF attachment the item itself *is* the PDF, so its own
        // key is the attachment key; other papers resolve their PDF lazily.
        let tops = items.filter { $0.data.parentItem == nil }
        let topKeys = Set(tops.map(\.data.key))

        let existing = (try? context.fetch(FetchDescriptor<CachedPaper>())) ?? []
        var byKey = Dictionary(
            existing.map { ($0.zoteroKey, $0) }, uniquingKeysWith: { a, _ in a })

        // Items with an unsynced local change keep their optimistic state — the
        // remote tags may not reflect the change yet (esp. via the web write +
        // local read round-trip), so don't clobber them this pass.
        let pendingOutbox: Set<String> = {
            let actions = (try? context.fetch(
                FetchDescriptor<OutboxAction>())) ?? []
            return Set(actions.map(\.paperKey))
        }()

        var discoveredQueues: [String] = []
        let now = Date()
        for item in tops {
            let d = item.data
            let tags = (d.tags ?? []).map(\.tag)
            // A standalone PDF attachment is its own PDF — seed its key so
            // "Open PDF in Zotero" works without a child lookup.
            let selfPdfKey = (d.itemType == "attachment"
                && d.contentType == "application/pdf") ? d.key : nil
            let creators = splitCreators(d.creators)

            let paper: CachedPaper
            if let p = byKey[d.key] {
                paper = p
            } else {
                paper = CachedPaper(
                    zoteroKey: d.key, zoteroVersion: d.version,
                    title: d.title ?? "(untitled)",
                    authors: creators.authors, editors: creators.editors,
                    publicationTitle: d.publicationTitle, dateString: d.date,
                    doi: d.doi, urlString: d.url, tags: tags,
                    pdfAttachmentKey: selfPdfKey, readStatus: "unread",
                    addedAt: d.dateAdded, sortPriority: 0)
                context.insert(paper)
                byKey[d.key] = paper
            }

            // Always refresh metadata (but preserve a lazily-resolved PDF key).
            paper.zoteroVersion = d.version
            paper.title = d.title ?? "(untitled)"
            paper.authors = creators.authors
            paper.editors = creators.editors
            paper.publicationTitle = d.publicationTitle
            paper.dateString = d.date
            paper.doi = d.doi
            paper.urlString = d.url
            paper.addedAt = d.dateAdded
            paper.collectionKeys = d.collections
            paper.tags = tags
            paper.updatedAt = now

            guard tagsAuthoritative, !pendingOutbox.contains(d.key) else { continue }

            // Web mode: derive queue/read state from pq: tags.
            let read = isRead(tags)
            let skipped = tags.contains(Self.skipTag)
            let queued = tags.contains(Self.queueTag)
            paper.readStatus = read ? "read" : (skipped ? "skipped" : "unread")
            paper.readDate = read ? parseReadDate(tags) : nil
            paper.sortPriority = parsePos(tags) ?? .greatestFiniteMagnitude

            if read {
                paper.queueStatus = "read"
                paper.queueName = nil
                paper.isPending = false
            } else if skipped {
                paper.queueStatus = "skipped"
                paper.queueName = nil
                paper.isPending = false
            } else if queued {
                let queueName = parseQueueName(tags)
                paper.queueName = queueName
                if let queueName { discoveredQueues.append(queueName) }
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
                paper.queueName = nil
                paper.isPending = false
            }
        }

        for paper in existing where !topKeys.contains(paper.zoteroKey) {
            context.delete(paper)
        }
        try? context.save()
        registerQueues(discoveredQueues)
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

    // MARK: - Queues

    /// Maps a display name to the stored queue name (`nil` for the Default
    /// queue, which uses a bare `pq:queue` tag with no `pq:qname:`).
    private func storedName(for display: String) -> String? {
        display == AppConfig.defaultQueueName ? nil : display
    }

    /// Reloads the published queue list from persistence, keeping `activeQueue`
    /// valid.
    private func refreshQueues() {
        availableQueues = AppConfig.allQueueNames
        if !availableQueues.contains(activeQueue) {
            activeQueue = AppConfig.defaultQueueName
            AppConfig.activeQueueName = activeQueue
        }
    }

    /// Adds any queue names discovered from synced tags to the persisted list.
    private func registerQueues(_ names: [String]) {
        let new = names.uniqued().filter {
            !AppConfig.allQueueNames.contains($0)
        }
        guard !new.isEmpty else { return }
        AppConfig.customQueueNames = AppConfig.customQueueNames + new
        refreshQueues()
    }

    func setActiveQueue(_ name: String) {
        guard availableQueues.contains(name) else { return }
        activeQueue = name
        AppConfig.activeQueueName = name
    }

    /// Creates a personalized queue and makes it active. No-op for blank or
    /// duplicate names.
    @discardableResult
    func createQueue(_ rawName: String) -> Bool {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty,
              !AppConfig.allQueueNames.contains(where: {
                  $0.caseInsensitiveCompare(name) == .orderedSame })
        else { return false }
        AppConfig.customQueueNames = AppConfig.customQueueNames + [name]
        refreshQueues()
        setActiveQueue(name)
        return true
    }

    /// Deletes a personalized queue, moving its papers to the Default queue.
    /// The Default queue cannot be deleted.
    func deleteQueue(_ name: String) {
        guard name != AppConfig.defaultQueueName else { return }
        let stored = storedName(for: name)
        let descriptor = FetchDescriptor<CachedPaper>(
            predicate: #Predicate { $0.isPending })
        let members = ((try? context.fetch(descriptor)) ?? [])
            .filter { $0.queueName == stored }
        for paper in members {
            addToQueue(paper, queue: AppConfig.defaultQueueName)
        }
        AppConfig.customQueueNames = AppConfig.customQueueNames
            .filter { $0 != name }
        if activeQueue == name { activeQueue = AppConfig.defaultQueueName }
        AppConfig.activeQueueName = activeQueue
        refreshQueues()
    }

    // MARK: - Mutations

    /// Adds (or moves) a paper to a queue. Defaults to the Default queue when no
    /// queue is specified.
    func addToQueue(_ paper: CachedPaper, queue: String = AppConfig.defaultQueueName) {
        let stored = storedName(for: queue)
        let pos = nextPosition(in: stored)
        paper.readStatus = "unread"
        paper.queueStatus = "pending"
        paper.queueName = stored
        paper.postponedUntil = nil
        paper.readDate = nil
        paper.isPending = true
        paper.sortPriority = pos
        applyState(
            paper, queued: true, read: false, skipped: false, pos: pos,
            queueName: stored)
    }

    /// Moves an already-queued paper to another queue (alias of addToQueue).
    func moveToQueue(_ paper: CachedPaper, queue: String) {
        addToQueue(paper, queue: queue)
    }

    func markRead(_ paper: CachedPaper) {
        paper.readStatus = "read"
        paper.queueStatus = "read"
        paper.queueName = nil
        paper.postponedUntil = nil
        paper.readDate = Date()
        paper.isPending = false
        applyState(
            paper, queued: false, read: true, skipped: false, pos: nil,
            queueName: nil)
    }

    func skip(_ paper: CachedPaper) {
        paper.readStatus = "skipped"
        paper.queueStatus = "skipped"
        paper.queueName = nil
        paper.readDate = nil
        paper.isPending = false
        applyState(
            paper, queued: false, read: false, skipped: true, pos: nil,
            queueName: nil)
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
        paper.queueName = nil
        paper.postponedUntil = nil
        paper.readDate = nil
        paper.isPending = false
        applyState(
            paper, queued: false, read: false, skipped: false, pos: nil,
            queueName: nil)
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

    /// Adds a Zotero item picked from a collection to a queue.
    func enqueue(_ item: ZoteroItem, queue: String = AppConfig.defaultQueueName) {
        let d = item.data
        let key = d.key
        let descriptor = FetchDescriptor<CachedPaper>(
            predicate: #Predicate { $0.zoteroKey == key })
        let paper: CachedPaper
        if let existing = try? context.fetch(descriptor).first {
            paper = existing
        } else {
            let creators = splitCreators(d.creators)
            paper = CachedPaper(
                zoteroKey: d.key, zoteroVersion: d.version,
                title: d.title ?? "(untitled)",
                authors: creators.authors, editors: creators.editors,
                publicationTitle: d.publicationTitle, dateString: d.date,
                doi: d.doi, urlString: d.url, tags: (d.tags ?? []).map(\.tag),
                pdfAttachmentKey: nil, readStatus: "unread",
                addedAt: d.dateAdded, sortPriority: 0)
            context.insert(paper)
        }
        addToQueue(paper, queue: queue)
    }

    /// Clears the entire local cache (used on sign-out / account switch).
    func wipeCache() {
        try? context.delete(model: CachedPaper.self)
        try? context.delete(model: OutboxAction.self)
        try? context.delete(model: ReadingSessionLocal.self)
        try? context.save()
        syncSummary = nil
        refreshQueues()
        updateWidget()
    }

    /// Adds a paper to the Zotero library by DOI (metadata via Crossref), then
    /// resyncs. Returns true on success.
    func addByDOI(_ doi: String) async -> Bool {
        // Creating items needs a writable (web) client; the local API is
        // read-only.
        guard let zotero = ZoteroAPI.webWriteClient() ?? ZoteroAPI.current()
        else { return false }
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
                    pos: newPos, queueName: paper.queueName)
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
        pos: Double?, queueName: String?
    ) {
        let tags = desiredTags(
            paper.tags, queued: queued, read: read, skipped: skipped, pos: pos,
            queueName: queueName)
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
        guard writesTags, let zotero = ZoteroAPI.webWriteClient() else { return }
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
        _ base: [String], queued: Bool, read: Bool, skipped: Bool, pos: Double?,
        queueName: String?
    ) -> [String] {
        var tags = base.filter { !$0.hasPrefix("pq:") }
        if queued {
            tags.append(Self.queueTag)
            if let pos { tags.append(Self.posPrefix + String(Int(pos))) }
            if let queueName, !queueName.isEmpty {
                tags.append(Self.qnamePrefix + queueName)
            }
        }
        if read {
            tags.append(Self.readTag + ":"
                + Self.readDateFormatter.string(from: Date()))
            // User-configured extra tags applied on completion (optional).
            tags.append(contentsOf: AppConfig.readExtraTags)
        }
        if skipped { tags.append(Self.skipTag) }
        return tags.uniqued()
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

    private func parseQueueName(_ tags: [String]) -> String? {
        for tag in tags where tag.hasPrefix(Self.qnamePrefix) {
            let name = String(tag.dropFirst(Self.qnamePrefix.count))
            return name.isEmpty ? nil : name
        }
        return nil
    }

    private func nextPosition(in queueName: String?) -> Double {
        let descriptor = FetchDescriptor<CachedPaper>(
            predicate: #Predicate { $0.isPending })
        let pending = ((try? context.fetch(descriptor)) ?? [])
            .filter { $0.queueName == queueName }
        let maxPos = pending.map(\.sortPriority)
            .filter { $0 < .greatestFiniteMagnitude }
            .max() ?? 0
        return maxPos + Self.posGap
    }

    private func creatorName(_ c: ZoteroCreator) -> String {
        if let name = c.name { return name }
        if let last = c.lastName, let first = c.firstName {
            return "\(last), \(first)"
        }
        return c.lastName ?? c.firstName ?? ""
    }

    /// Splits Zotero creators into authors and editors so both are shown (an
    /// edited volume often lists editors *before* authors — flattening them hid
    /// the real authors behind an "editor et al."). Non-author/editor roles
    /// (translator, etc.) count as authors only when there are no real authors.
    private func splitCreators(
        _ creators: [ZoteroCreator]?
    ) -> (authors: [String], editors: [String]) {
        var authors: [String] = []
        var editors: [String] = []
        var others: [String] = []
        for c in creators ?? [] {
            let name = creatorName(c)
            guard !name.isEmpty else { continue }
            let type = c.creatorType.lowercased()
            if type.contains("editor") {
                editors.append(name)
            } else if ["author", "bookauthor", "contributor", "presenter",
                       "podcaster", "interviewee", "director", "inventor",
                       "cartographer", "programmer"].contains(type) {
                authors.append(name)
            } else {
                others.append(name)
            }
        }
        if authors.isEmpty { authors = others }
        return (authors, editors)
    }

    // MARK: - Widget

    func updateWidget() {
        let descriptor = FetchDescriptor<CachedPaper>(
            predicate: #Predicate { $0.isPending },
            sortBy: [SortDescriptor(\.sortPriority), SortDescriptor(\.zoteroKey)])
        let pending = (try? context.fetch(descriptor)) ?? []
        let next = pending.first

        // Streak + today's goal progress for the widget's gamification line.
        let allPapers = (try? context.fetch(FetchDescriptor<CachedPaper>())) ?? []
        let g = StatsService.quickGamification(papers: allPapers)

        let snapshot = WidgetSnapshot(
            pendingCount: pending.count,
            nextTitle: next?.title,
            nextAuthors: next?.authorLine,
            nextPaperKey: next?.zoteroKey,
            updatedAt: Date(),
            streakDays: g.streak,
            readToday: g.readToday,
            dailyGoal: g.goal)
        WidgetBridge.write(snapshot)
        WidgetCenter.shared.reloadAllTimelines()
    }
}
