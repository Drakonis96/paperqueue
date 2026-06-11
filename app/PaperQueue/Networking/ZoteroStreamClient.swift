import Foundation

/// Holds a live WebSocket to Zotero's streaming API (`wss://stream.zotero.org`)
/// so changes anywhere in the library — another device, the Zotero apps,
/// zotero.org — surface within ~a second instead of waiting for a manual
/// refresh.
///
/// The protocol is deliberately thin: on connect the server sends
/// `{"event":"connected","retry":N}`, we reply with a `createSubscriptions`
/// message carrying the API key + the user topic, and from then on the server
/// pushes `{"event":"topicUpdated","topic":...,"version":N}` whenever the
/// library changes. The event is only a *signal* (it carries no data), so the
/// owner reacts by running its normal incremental sync.
///
/// All mutable state is confined to a private serial queue, so the URLSession
/// completion callbacks (which arrive on arbitrary threads) never race. The
/// connection self-heals: any drop schedules a reconnect with capped backoff,
/// honouring the server's suggested `retry` interval.
///
/// `@unchecked Sendable` is sound here because every mutable field is read and
/// written only on `queue`.
final class ZoteroStreamClient: @unchecked Sendable {
    private let apiKey: String
    private let topic: String
    /// Called (off the main actor) with the new library version when the library
    /// changes. Hop to the main actor inside the closure if needed.
    private let onTopicUpdated: @Sendable (Int) -> Void

    private let session = URLSession(configuration: .default)
    private let queue = DispatchQueue(label: "com.paperqueue.zotero-stream")

    // Everything below is touched only on `queue`.
    private var task: URLSessionWebSocketTask?
    private var isRunning = false
    private var reconnectDelay: TimeInterval = 10

    private static let baseReconnectDelay: TimeInterval = 10
    private static let maxReconnectDelay: TimeInterval = 120
    private static let streamURL = URL(string: "wss://stream.zotero.org")!

    init(
        apiKey: String, userId: String,
        onTopicUpdated: @escaping @Sendable (Int) -> Void
    ) {
        self.apiKey = apiKey
        self.topic = "/users/\(userId)"
        self.onTopicUpdated = onTopicUpdated
    }

    /// Opens the connection (idempotent — a second call while running is a no-op).
    func start() {
        queue.async { [weak self] in
            guard let self, !self.isRunning else { return }
            self.isRunning = true
            self.reconnectDelay = Self.baseReconnectDelay
            self.connect()
        }
    }

    /// Closes the connection and stops reconnecting.
    func stop() {
        queue.async { [weak self] in
            guard let self else { return }
            self.isRunning = false
            self.task?.cancel(with: .goingAway, reason: nil)
            self.task = nil
        }
    }

    // MARK: - Connection (all on `queue`)

    private func connect() {
        guard isRunning else { return }
        let socket = session.webSocketTask(with: Self.streamURL)
        task = socket
        socket.resume()
        receive()
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            self.queue.async {
                guard self.isRunning else { return }
                switch result {
                case .failure:
                    self.scheduleReconnect()
                case .success(let message):
                    self.handle(message)
                    self.receive()   // keep listening
                }
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case .string(let text): data = Data(text.utf8)
        case .data(let raw): data = raw
        @unknown default: return
        }
        guard let obj = try? JSONSerialization.jsonObject(with: data)
                as? [String: Any],
              let event = obj["event"] as? String else { return }

        switch event {
        case "connected":
            // The server suggests a reconnect interval (ms); honour it as our
            // backoff floor.
            if let retry = obj["retry"] as? Double {
                reconnectDelay = retry / 1000
            }
            subscribe()
        case "topicUpdated":
            // A number from JSONSerialization arrives as NSNumber → read as Int.
            let version = (obj["version"] as? Int)
                ?? (obj["version"] as? Double).map(Int.init) ?? -1
            onTopicUpdated(version)
        default:
            // subscriptionsCreated / topicAdded / topicRemoved — nothing to do;
            // a single key already covers the library, and a real change always
            // arrives as topicUpdated.
            break
        }
    }

    private func subscribe() {
        let payload: [String: Any] = [
            "action": "createSubscriptions",
            "subscriptions": [["apiKey": apiKey, "topics": [topic]]],
        ]
        guard let body = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: body, encoding: .utf8) else { return }
        task?.send(.string(json)) { [weak self] error in
            guard let self else { return }
            self.queue.async {
                if error == nil {
                    // A clean subscribe resets backoff for the next drop.
                    self.reconnectDelay = Self.baseReconnectDelay
                }
            }
        }
    }

    private func scheduleReconnect() {
        guard isRunning else { return }
        task = nil
        let delay = reconnectDelay
        reconnectDelay = min(reconnectDelay * 1.5, Self.maxReconnectDelay)
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.isRunning else { return }
            self.connect()
        }
    }
}
