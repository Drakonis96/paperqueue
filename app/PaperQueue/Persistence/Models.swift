import Foundation
import SwiftData

/// Locally cached Zotero item. Identity is the Zotero item key. Drives the UI
/// even when offline.
@Model
final class CachedPaper {
    @Attribute(.unique) var zoteroKey: String
    var zoteroVersion: Int
    var title: String
    var authors: [String]
    /// Editor names, kept separate so they're shown as editors (and never hide
    /// the actual authors). Default `[]` for items synced before 1.6.
    var editors: [String] = []
    var publicationTitle: String?
    var dateString: String?
    var doi: String?
    var urlString: String?
    /// Zotero page range, e.g. "134-136". Default nil for items synced pre-1.7.
    var pages: String?
    var tags: [String]
    var pdfAttachmentKey: String?
    /// Zotero collection keys this paper belongs to (for the collection filter).
    var collectionKeys: [String]?
    /// "unread" | "reading" | "read" | "skipped"
    var readStatus: String
    /// "pending" | "postponed" | "read" | "skipped"
    var queueStatus: String?
    /// Name of the queue this paper belongs to. `nil` means the Default queue
    /// (stored as a bare `pq:queue` tag); a value maps to a `pq:qname:<value>`
    /// tag. Only meaningful while the paper is queued.
    var queueName: String?
    var postponedUntil: Date?
    /// Real read date, decoded from the `pq:read:<date>` tag (multi-device).
    var readDate: Date?
    var addedAt: String?

    var sortPriority: Double
    /// Whether this paper should appear in the pending queue right now.
    var isPending: Bool
    var lastPageRead: Int?
    var updatedAt: Date

    init(
        zoteroKey: String,
        zoteroVersion: Int,
        title: String,
        authors: [String],
        editors: [String] = [],
        publicationTitle: String?,
        dateString: String?,
        doi: String?,
        urlString: String?,
        pages: String? = nil,
        tags: [String],
        pdfAttachmentKey: String?,
        readStatus: String,
        addedAt: String?,
        sortPriority: Double
    ) {
        self.zoteroKey = zoteroKey
        self.zoteroVersion = zoteroVersion
        self.title = title
        self.authors = authors
        self.editors = editors
        self.publicationTitle = publicationTitle
        self.dateString = dateString
        self.doi = doi
        self.urlString = urlString
        self.pages = pages
        self.tags = tags
        self.pdfAttachmentKey = pdfAttachmentKey
        self.collectionKeys = nil
        self.readStatus = readStatus
        // Imported items are NOT auto-queued. The queue is curated explicitly
        // (via the `pq:queue` tag / "Add to queue").
        self.queueStatus = nil
        self.queueName = nil
        self.postponedUntil = nil
        self.readDate = nil
        self.addedAt = addedAt
        self.sortPriority = sortPriority
        self.isPending = false
        self.lastPageRead = nil
        self.updatedAt = Date()
    }

    var hasPdf: Bool { pdfAttachmentKey != nil }

    /// Pages inferred from the Zotero page range (e.g. "134-136" → 2). Handles
    /// abbreviated ends ("134-36"/"134-6" → 2). Single pages / non-numeric
    /// values yield nil. Convention: end − start.
    var pageCount: Int? { CachedPaper.pageCount(from: pages) }

    static func pageCount(from raw: String?) -> Int? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let match = raw.range(
                  of: #"(\d+)\s*[-–—]\s*(\d+)"#, options: .regularExpression)
        else { return nil }
        let nums = raw[match]
            .split(whereSeparator: { !$0.isNumber })
            .map(String.init)
        guard nums.count == 2 else { return nil }
        let startStr = nums[0]
        var endStr = nums[1]
        // Expand an abbreviated end ("134-36" → "136") to the start's width.
        if endStr.count < startStr.count {
            endStr = String(startStr.prefix(startStr.count - endStr.count)) + endStr
        }
        guard let start = Int(startStr), let end = Int(endStr), end > start else {
            return nil
        }
        return end - start
    }

    /// All creators (authors first, then editors) — for the author filter/sort.
    var allCreators: [String] { authors + editors }

    /// "Last, First" / "First et al." for a name list.
    private func shortNames(_ names: [String]) -> String {
        if names.count <= 2 { return names.joined(separator: ", ") }
        return "\(names[0]) et al."
    }

    /// Authors and editors, both shown so neither is lost. Editors are labelled
    /// (e.g. "ed." / "eds.") and never displace the actual authors.
    var authorLine: String {
        if !authors.isEmpty {
            var line = shortNames(authors)
            if !editors.isEmpty { line += " · ed. \(shortNames(editors))" }
            return line
        }
        if !editors.isEmpty {
            let label = editors.count > 1 ? "eds." : "ed."
            return "\(shortNames(editors)) (\(label))"
        }
        return "Unknown author"
    }

    var year: String? {
        guard let dateString else { return nil }
        if let match = dateString.range(
            of: #"\d{4}"#, options: .regularExpression) {
            return String(dateString[match])
        }
        return dateString
    }

    var subtitle: String {
        [publicationTitle, year].compactMap { $0 }.joined(separator: " · ")
    }
}

/// A pending tag write that still needs to reach Zotero (offline support).
/// Captures the exact tag set to apply to an item.
@Model
final class OutboxAction {
    @Attribute(.unique) var id: UUID
    var paperKey: String
    var tags: [String]
    var createdAt: Date

    init(paperKey: String, tags: [String]) {
        self.id = UUID()
        self.paperKey = paperKey
        self.tags = tags
        self.createdAt = Date()
    }
}

/// A timed reading session, stored locally (Zotero has no concept of these).
@Model
final class ReadingSessionLocal {
    @Attribute(.unique) var id: UUID
    var paperKey: String
    var startedAt: Date
    var endedAt: Date?
    var durationSeconds: Int
    var lastPage: Int?
    var totalPages: Int?

    init(
        paperKey: String,
        startedAt: Date = Date(),
        totalPages: Int? = nil
    ) {
        self.id = UUID()
        self.paperKey = paperKey
        self.startedAt = startedAt
        self.endedAt = nil
        self.durationSeconds = 0
        self.lastPage = nil
        self.totalPages = totalPages
    }
}
