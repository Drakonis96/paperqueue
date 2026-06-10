import Foundation
import SwiftUI

/// Lightweight navigation state: which tab is selected and whether a paper
/// should be opened in the reader (e.g. from the widget deep link).
@MainActor
final class AppRouter: ObservableObject {
    enum Tab: Hashable, CaseIterable {
        case queue, library, history, stats, settings

        var title: String {
            switch self {
            case .queue: return "Queue"
            case .library: return "Library"
            case .history: return "History"
            case .stats: return "Stats"
            case .settings: return "Settings"
            }
        }

        var systemImage: String {
            switch self {
            case .queue: return "list.bullet.rectangle"
            case .library: return "books.vertical"
            case .history: return "clock.arrow.circlepath"
            case .stats: return "chart.bar"
            case .settings: return "gearshape"
            }
        }
    }

    @Published var selectedTab: Tab = .queue
    @Published var readerPaperKey: String?

    /// Handles `paperqueue://` deep links from the widget.
    func handle(_ url: URL) {
        guard url.scheme == AppConfig.urlScheme else { return }
        switch url.host {
        case "reader":
            if let key = url.pathComponents.last, key != "/" {
                selectedTab = .queue
                readerPaperKey = key
            }
        case "queue":
            selectedTab = .queue
        default:
            break
        }
    }
}
