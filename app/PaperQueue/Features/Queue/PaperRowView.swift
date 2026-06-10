import SwiftUI

struct PaperRowView: View {
    let paper: CachedPaper
    var showStatus = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: paper.hasPdf ? "doc.richtext" : "doc.text")
                .font(.title3)
                .foregroundStyle(paper.hasPdf ? Theme.accent : .secondary)
                .frame(width: 28)
                .contentTransition(.symbolEffect(.replace))

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
