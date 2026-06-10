import SwiftData
import SwiftUI

/// Paper detail + reading-queue actions. PDF reading happens in Zotero on the
/// Mac; iOS/iPadOS is a companion (manage the queue, mark read, add papers).
struct PaperDetailView: View {
    let paperKey: String

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var store: QueueStore

    @State private var paper: CachedPaper?

    var body: some View {
        ScrollView {
            if let paper {
                VStack(alignment: .leading, spacing: 20) {
                    header(paper)
                    if !paper.tags.isEmpty { tagChips(paper) }
                    openInZotero(paper)
                    actions(paper)
                }
                .padding()
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            } else {
                ProgressView().padding()
            }
        }
        .navigationTitle("Paper")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
    }

    private func header(_ paper: CachedPaper) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(paper.title)
                .font(.title2.bold())
            Text(paper.authorLine)
                .font(.headline)
                .foregroundStyle(.secondary)
            if !paper.subtitle.isEmpty {
                Text(paper.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
            }
            statusBadge(paper)
        }
    }

    private func statusBadge(_ paper: CachedPaper) -> some View {
        let (label, color): (String, Color) = {
            switch paper.readStatus {
            case "read": return ("Read", .green)
            case "skipped": return ("Skipped", .orange)
            default:
                if paper.queueStatus == "postponed" {
                    return ("Postponed", .orange)
                }
                if let name = paper.queueName {
                    return ("In “\(name)”", .blue)
                }
                return ("In queue", .blue)
            }
        }()
        return Text(label)
            .font(.caption.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(color.opacity(0.15), in: Capsule())
            .foregroundStyle(color)
    }

    private func tagChips(_ paper: CachedPaper) -> some View {
        let visible = paper.tags.filter { !$0.hasPrefix("_") }
        return Group {
            if !visible.isEmpty {
                ViewThatFits(in: .horizontal) {
                    HStack { ForEach(visible, id: \.self, content: chip) }
                    VStack(alignment: .leading) {
                        ForEach(visible, id: \.self, content: chip)
                    }
                }
            }
        }
    }

    private func chip(_ tag: String) -> some View {
        Text(tag)
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Theme.cardBackground, in: Capsule())
    }

    @ViewBuilder
    private func openInZotero(_ paper: CachedPaper) -> some View {
        #if os(macOS)
        Button {
            openURL(AppConfig.zoteroOpenURL(
                attachmentKey: paper.pdfAttachmentKey, itemKey: paper.zoteroKey))
        } label: {
            Label(
                paper.hasPdf ? "Open PDF in Zotero" : "Show in Zotero",
                systemImage: "arrow.up.forward.app")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        #else
        if paper.hasPdf {
            Label("PDF available — read it on your Mac", systemImage: "desktopcomputer")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        #endif
    }

    @ViewBuilder
    private func actions(_ paper: CachedPaper) -> some View {
        VStack(spacing: 10) {
            if paper.readStatus == "read" || paper.readStatus == "skipped" {
                Button {
                    store.reset(paper)
                    dismiss()
                } label: {
                    Label("Move back to queue", systemImage: "arrow.uturn.left")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Button(role: .destructive) {
                    store.removeFromHistory(paper)
                    dismiss()
                } label: {
                    Label("Remove from history", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            } else if paper.isPending {
                // Already in the queue.
                Button {
                    store.markRead(paper)
                    dismiss()
                } label: {
                    Label("Mark as read", systemImage: "checkmark.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.green)

                if store.availableQueues.count > 1 {
                    Menu {
                        let current = paper.queueName ?? AppConfig.defaultQueueName
                        ForEach(store.availableQueues, id: \.self) { queue in
                            Button {
                                store.moveToQueue(paper, queue: queue)
                            } label: {
                                Label(queue, systemImage: queue == current
                                    ? "checkmark" : "tray")
                            }
                            .disabled(queue == current)
                        }
                    } label: {
                        Label("Move to another queue",
                              systemImage: "tray.and.arrow.down")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }

                HStack {
                    Button {
                        store.postpone(paper)
                        dismiss()
                    } label: {
                        Label("Postpone", systemImage: "clock")
                            .frame(maxWidth: .infinity)
                    }
                    Button(role: .destructive) {
                        store.skip(paper)
                        dismiss()
                    } label: {
                        Label("Skip", systemImage: "xmark")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.bordered)

                Button {
                    store.removeFromQueue(paper)
                    dismiss()
                } label: {
                    Label("Remove from queue", systemImage: "minus.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.secondary)
            } else {
                // In the library but not queued yet.
                Button {
                    store.addToQueue(paper)
                    dismiss()
                } label: {
                    Label("Add to reading queue", systemImage: "text.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                if store.availableQueues.count > 1 {
                    Menu {
                        ForEach(store.availableQueues, id: \.self) { queue in
                            Button {
                                store.addToQueue(paper, queue: queue)
                                dismiss()
                            } label: {
                                Label(queue, systemImage: queue
                                    == AppConfig.defaultQueueName
                                        ? "tray.full" : "tray")
                            }
                        }
                    } label: {
                        Label("Add to a specific queue", systemImage: "tray.2")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }

                Button {
                    store.markRead(paper)
                    dismiss()
                } label: {
                    Label("Mark as read", systemImage: "checkmark.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
        .controlSize(.large)
    }

    private func load() async {
        let key = paperKey
        let descriptor = FetchDescriptor<CachedPaper>(
            predicate: #Predicate { $0.zoteroKey == key })
        paper = try? modelContext.fetch(descriptor).first

        #if os(macOS)
        // Resolve the PDF attachment lazily so "Open PDF in Zotero" works.
        if let p = paper, p.pdfAttachmentKey == nil,
           let zotero = ZoteroAPI.current(),
           let kids = try? await zotero.children(of: p.zoteroKey),
           let pdf = kids.first(where: { $0.data.contentType == "application/pdf" }) {
            p.pdfAttachmentKey = pdf.key
            try? modelContext.save()
        }
        #endif
    }
}
