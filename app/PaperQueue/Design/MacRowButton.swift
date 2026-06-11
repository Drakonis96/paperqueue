#if os(macOS)
import SwiftUI

/// A clearly-clickable icon button for macOS list rows — swipe actions are
/// awkward with a mouse, so on the Mac we surface the same actions as
/// always-visible buttons on the right of each row. Highlights on hover.
struct MacRowButton: View {
    let icon: String
    var tint: Color = .secondary
    let help: String
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 34, height: 34)
                .background(
                    hovering ? Color.secondary.opacity(0.15) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .onHover { hovering = $0 }
        .help(help)
    }
}

/// Mac list-row interaction: a single click selects the row immediately (with a
/// tinted background) and a second click within the double-click window opens
/// it. Avoids the lag of disambiguating two separate tap-count gestures.
struct MacRowInteraction: ViewModifier {
    @Binding var selection: String?
    let key: String
    let onOpen: () -> Void

    @State private var lastTapAt: Date = .distantPast

    func body(content: Content) -> some View {
        content
            .listRowBackground(
                selection == key ? Theme.accent.opacity(0.14) : Color.clear)
            .contentShape(Rectangle())
            .onTapGesture {
                let now = Date()
                if selection == key, now.timeIntervalSince(lastTapAt) < 0.45 {
                    onOpen()
                } else {
                    selection = key
                }
                lastTapAt = now
            }
    }
}

extension View {
    func macRowInteraction(
        selection: Binding<String?>, key: String,
        onOpen: @escaping () -> Void
    ) -> some View {
        modifier(MacRowInteraction(selection: selection, key: key, onOpen: onOpen))
    }
}
#endif
