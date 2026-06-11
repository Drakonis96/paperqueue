#if os(macOS)
import SwiftUI

/// A compact, clearly-clickable icon button for macOS list rows — swipe actions
/// are awkward with a mouse, so on the Mac we surface the same actions as
/// always-visible buttons on the right of each row.
struct MacRowButton: View {
    let icon: String
    var tint: Color = .secondary
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(tint)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .help(help)
    }
}
#endif
