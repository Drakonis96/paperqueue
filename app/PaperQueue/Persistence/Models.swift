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
    var publicationTitle: String?
    var dateString: String?
    var doi: String?
    var urlString: String?
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
        publicationTitle: String?,
        dateString: String?,
        doi: String?,
        urlString: String?,
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
        self.publicationTitle = publicationTitle
        self.dateString = dateString
        self.doi = doi
        self.urlString = urlString
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

    var authorLine: String {
        if authors.isEmpty { return "Unknown author" }
        if authors.count <= 2 { return authors.joined(separator: ", ") }
        return "\(authors[0]) et al."
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
