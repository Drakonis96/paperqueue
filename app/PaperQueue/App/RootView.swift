import SwiftData
import SwiftUI

/// Switches between the login screen and the main app based on auth state.
struct RootView: View {
    @EnvironmentObject private var auth: AuthManager

    var body: some View {
        switch auth.state {
        case .unknown:
            ProgressView("Loading…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .signedOut, .error:
            LoginView()
        case .signedIn:
            MainView()
        }
    }
}

/// App shell shown once signed in: a sidebar on macOS, tabs on iOS/iPadOS.
struct MainView: View {
    @EnvironmentObject private var router: AppRouter
    @EnvironmentObject private var store: QueueStore

    var body: some View {
        Group {
            #if os(macOS)
            sidebar
            #else
            tabs
            #endif
        }
        .task {
            NotificationManager.sync()
            await store.initialLoad()
        }
    }

    @ViewBuilder
    private func screen(for tab: AppRouter.Tab) -> some View {
        switch tab {
        case .queue: QueueView()
        case .library: LibraryView()
        case .history: HistoryView()
        case .stats: StatsView()
        case .settings: SettingsView()
        }
    }

    #if os(macOS)
    private var sidebar: some View {
        let selection = Binding(
            get: { router.selectedTab as AppRouter.Tab? },
            set: { router.selectedTab = $0 ?? .queue })
        return NavigationSplitView {
            List(AppRouter.Tab.allCases, id: \.self, selection: selection) { tab in
                Label(tab.title, systemImage: tab.systemImage)
            }
            .navigationTitle("PaperQueue")
            .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 280)
        } detail: {
            screen(for: router.selectedTab)
        }
    }
    #else
    private var tabs: some View {
        TabView(selection: $router.selectedTab) {
            ForEach(AppRouter.Tab.allCases, id: \.self) { tab in
                screen(for: tab)
                    .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                    .tag(tab)
            }
        }
    }
    #endif
}
