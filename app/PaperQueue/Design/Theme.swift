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

    /// A gentle spring used for subtle state-change animations across the app.
    static let subtleSpring = Animation.spring(response: 0.35, dampingFraction: 0.82)
}

/// A button style that gently scales and dims while pressed, so taps on the
/// small quick-action controls feel responsive without being flashy.
struct PressableButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.88 : 1)
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7),
                       value: configuration.isPressed)
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
