import SwiftData
import SwiftUI

@main
struct PaperQueueApp: App {
    @StateObject private var auth = AuthManager()
    @StateObject private var router = AppRouter()
    @StateObject private var store: QueueStore

    let container: ModelContainer

    init() {
        let container: ModelContainer
        do {
            container = try ModelContainer(
                for: CachedPaper.self, OutboxAction.self,
                ReadingSessionLocal.self)
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
        self.container = container
        _store = StateObject(
            wrappedValue: QueueStore(context: container.mainContext))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .environmentObject(router)
                .environmentObject(store)
                .modelContainer(container)
                .onOpenURL { router.handle($0) }
                .task { await auth.bootstrap() }
        }
        #if os(macOS)
        .defaultSize(width: 980, height: 720)
        #endif
    }
}
