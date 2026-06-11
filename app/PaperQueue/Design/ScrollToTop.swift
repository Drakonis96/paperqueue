import SwiftUI

/// Stable identifiers used by the "scroll to top" floating button.
enum ScrollAnchors {
    static let top = "pq.scroll.top"
}

/// A zero-height list row that marks the top of a List so the floating button
/// can scroll back to it. Place it as the first row inside the main section.
struct TopAnchorRow: View {
    var body: some View {
        Color.clear
            .frame(height: 0)
            .id(ScrollAnchors.top)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .accessibilityHidden(true)
    }
}

/// Floating circular button that scrolls a list back to the top. Sits in the
/// bottom-right corner with a subtle material background and press animation.
struct ScrollTopFAB: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.up")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Theme.accent.opacity(0.25)))
                .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
        }
        .buttonStyle(PressableButtonStyle())
        .padding(.trailing, 18)
        .padding(.bottom, 22)
        .transition(.scale.combined(with: .opacity))
        .accessibilityLabel("Scroll to top")
    }
}

extension View {
    /// Overlays a scroll-to-top button (bottom-right) that animates the given
    /// proxy back to `TopAnchorRow`. Shown only when `visible` so short lists
    /// stay uncluttered.
    func scrollTopButton(
        visible: Bool, proxy: ScrollViewProxy
    ) -> some View {
        overlay(alignment: .bottomTrailing) {
            if visible {
                ScrollTopFAB {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        proxy.scrollTo(ScrollAnchors.top, anchor: .top)
                    }
                }
            }
        }
        .animation(Theme.subtleSpring, value: visible)
    }
}
