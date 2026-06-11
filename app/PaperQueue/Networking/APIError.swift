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
            guard nsError.domain == NSURLErrorDomain else { return false }
            let offlineCodes: [Int] = [
                NSURLErrorNotConnectedToInternet,
                NSURLErrorInternationalRoamingOff,
                NSURLErrorCallIsActive,
                NSURLErrorDataNotAllowed,
                NSURLErrorNetworkConnectionLost,
            ]
            return offlineCodes.contains(nsError.code)
        }
        return false
    }

    /// True for transient failures worth retrying later rather than discarding
    /// the work: rate limiting (429), request timeout (408), version conflicts
    /// (412) and 5xx, plus any transport-level blip. A 4xx like 403 (no write
    /// access) or 404 (item gone) is permanent and shouldn't be retried. Used by
    /// the outbox so a temporary hiccup doesn't permanently drop a tag write.
    var isRetryable: Bool {
        switch self {
        case let .server(status, _):
            return status == 408 || status == 412 || status == 429
                || (500...599).contains(status)
        case .transport:
            return true
        default:
            return false
        }
    }

    /// True when the request was explicitly cancelled (e.g. pull-to-refresh
    /// dismissed before the network call finished).
    var isCancelled: Bool {
        if case let .transport(error) = self {
            let nsError = error as NSError
            return nsError.domain == NSURLErrorDomain
                && nsError.code == NSURLErrorCancelled
        }
        return false
    }
}
