import SwiftUI

struct PaperRowView: View {
    let paper: CachedPaper
    var showStatus = false
    /// 1-based position in the reading queue. When set, a numeric badge is
    /// shown under the icon.
    var position: Int?
    /// When provided (with `position`), the badge becomes a button — used to
    /// jump the paper to a specific position.
    var onPositionTap: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 5) {
                Image(systemName: paper.hasPdf ? "doc.richtext" : "doc.text")
                    .font(.title3)
                    .foregroundStyle(paper.hasPdf ? Theme.accent : .secondary)
                    .contentTransition(.symbolEffect(.replace))
                if let position {
                    positionBadge(position)
                }
            }
            .frame(width: 30)

            VStack(alignment: .leading, spacing: 4) {
                Text(paper.title)
                    .font(.headline)
                    .lineLimit(2)
                Text(paper.authorLine)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if !paper.subtitle.isEmpty {
                    Text(paper.subtitle)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            trailingBadge
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    /// Numeric position pill under the icon. Tappable when `onPositionTap` is
    /// supplied so the user can move the paper to a chosen position.
    @ViewBuilder
    private func positionBadge(_ position: Int) -> some View {
        let label = Text("\(position)")
            .font(.caption2.weight(.bold))
            .monospacedDigit()
            .foregroundStyle(Theme.accent)
            .frame(minWidth: 22)
            .padding(.vertical, 2)
            .background(Theme.accent.opacity(0.15), in: Capsule())
            .contentTransition(.numericText())
            .animation(Theme.subtleSpring, value: position)

        if let onPositionTap {
            Button(action: onPositionTap) { label }
                .buttonStyle(PressableButtonStyle())
                .help("Move to position")
        } else {
            label
        }
    }

    @ViewBuilder
    private var trailingBadge: some View {
        Group {
            if paper.queueStatus == "postponed" {
                Image(systemName: "clock.badge")
                    .foregroundStyle(.orange)
            } else if showStatus {
                switch paper.readStatus {
                case "read":
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                case "skipped":
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.orange)
                default:
                    EmptyView()
                }
            }
        }
        .transition(.scale.combined(with: .opacity))
        .animation(Theme.subtleSpring, value: paper.readStatus)
        .animation(Theme.subtleSpring, value: paper.queueStatus)
    }
}
