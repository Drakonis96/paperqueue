import Foundation

enum APIError: LocalizedError {
    case notAuthenticated
    case server(status: Int, message: String?)
    case decoding(Error)
    case transport(Error)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "You are not signed in."
        case let .server(status, message):
            return message ?? "Server error (\(status))."
        case let .decoding(error):
            return "Could not read the server response: \(error.localizedDescription)"
        case let .transport(error):
            return error.localizedDescription
        case .invalidResponse:
            return "Unexpected server response."
        }
    }

    /// True for errors that mean "we're probably offline" (so callers can fall
    /// back to cached data instead of surfacing an error).
    var isOffline: Bool {
        if case let .transport(error) = self {
            let nsError = error as NSError
            return nsError.domain == NSURLErrorDomain
        }
        return false
    }
}
