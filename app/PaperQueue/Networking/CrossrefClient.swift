import Foundation

/// Looks up paper metadata by DOI via the free Crossref API and maps it to a
/// Zotero item-data dictionary ready to POST.
enum CrossrefClient {
    private static let base = URL(string: "https://api.crossref.org/works/")!

    static func zoteroItem(forDOI rawDOI: String) async throws -> [String: Any] {
        let doi = rawDOI
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "https://doi.org/", with: "")
            .replacingOccurrences(of: "doi:", with: "")

        guard !doi.isEmpty,
              let encoded = doi.addingPercentEncoding(
                  withAllowedCharacters: .urlPathAllowed)
        else { throw APIError.server(status: 400, message: "Enter a valid DOI.") }

        var req = URLRequest(url: base.appendingPathComponent(encoded))
        // Crossref etiquette: identify the client.
        req.setValue("PaperQueue/1.0 (mailto:app@paperqueue.local)",
                     forHTTPHeaderField: "User-Agent")

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard http.statusCode == 200 else {
            throw APIError.server(
                status: http.statusCode,
                message: "No metadata found for that DOI.")
        }

        guard let root = try? JSONSerialization.jsonObject(with: data)
            as? [String: Any],
              let message = root["message"] as? [String: Any]
        else { throw APIError.server(status: 502, message: "Unexpected Crossref response.") }

        return mapToZotero(message, doi: doi)
    }

    private static func mapToZotero(
        _ m: [String: Any], doi: String
    ) -> [String: Any] {
        var item: [String: Any] = ["itemType": "journalArticle", "DOI": doi]

        if let title = (m["title"] as? [String])?.first { item["title"] = title }
        if let container = (m["container-title"] as? [String])?.first {
            item["publicationTitle"] = container
        }
        if let url = m["URL"] as? String { item["url"] = url }
        if let abstract = m["abstract"] as? String {
            item["abstractNote"] = stripHTML(abstract)
        }

        if let authors = m["author"] as? [[String: Any]] {
            item["creators"] = authors.map { a -> [String: String] in
                [
                    "creatorType": "author",
                    "firstName": (a["given"] as? String) ?? "",
                    "lastName": (a["family"] as? String) ?? "",
                ]
            }
        }

        if let issued = m["issued"] as? [String: Any],
           let parts = (issued["date-parts"] as? [[Int]])?.first {
            item["date"] = parts.map(String.init).joined(separator: "-")
        }

        return item
    }

    private static func stripHTML(_ s: String) -> String {
        s.replacingOccurrences(
            of: "<[^>]+>", with: "", options: .regularExpression)
    }
}
