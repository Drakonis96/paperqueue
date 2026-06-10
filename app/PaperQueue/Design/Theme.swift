import SwiftUI

/// Shared visual tokens so the app reads consistently across platforms.
enum Theme {
    static let accent = Color.accentColor
    static let cardBackground = Color.secondary.opacity(0.08)
    static let cornerRadius: CGFloat = 14

    static func readStatusColor(_ status: String) -> Color {
        switch status {
        case "read": return .green
        case "skipped": return .orange
        case "reading": return .blue
        default: return .secondary
        }
    }
}

extension Int {
    /// Formats a seconds count as "1h 23m" / "45m" / "30s".
    var asReadingDuration: String {
        let hours = self / 3600
        let minutes = (self % 3600) / 60
        let seconds = self % 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m" }
        return "\(seconds)s"
    }
}
