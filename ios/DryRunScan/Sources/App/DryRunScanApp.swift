import SwiftUI

@main
struct DryRunScanApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        switch model.screen {
        case .home: HomeView()
        case .capture: CaptureScreen()
        case .review: ReviewView()
        }
    }
}
