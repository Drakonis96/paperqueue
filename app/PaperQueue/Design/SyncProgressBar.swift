import SwiftUI

/// Thin progress bar shown at the top of a list while the library is fetching.
/// Self-gating: renders nothing when a sync isn't in progress. Used by both the
/// Queue and Library so a refresh is visible wherever it's triggered.
struct SyncProgressBar: View {
    @EnvironmentObject private var store: QueueStore

    var body: some View {
        if store.isSyncing {
            VStack(spacing: 4) {
                ProgressView(value: store.syncProgress ?? 0)
                    .progressViewStyle(.linear)
                Text(store.syncSummary ?? "Fetching library…")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
            .background(.bar)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}
