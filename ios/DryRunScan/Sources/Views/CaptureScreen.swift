import RoomPlan
import SwiftUI

/// Full-screen RoomPlan capture with Apple's coaching overlay and a big Done button.
struct CaptureScreen: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var controller: CaptureControllerBox = CaptureControllerBox()

    var body: some View {
        ZStack(alignment: .bottom) {
            if let c = controller.controller {
                RoomCaptureRepresentable(captureView: c.captureView)
                    .ignoresSafeArea()
                CaptureControls(controller: c, onCancel: cancel)
            }
        }
        .background(Color.black)
        .onAppear {
            let c = controller.make { result in model.captureFinished(result) }
            c.start()
        }
    }

    private func cancel() {
        controller.controller?.cancel()
        model.cancelCapture()
    }
}

/// Holds the controller so it is created once per capture screen and survives redraws.
@MainActor
final class CaptureControllerBox: ObservableObject {
    @Published private(set) var controller: RoomCaptureController?

    func make(onResult: @escaping @MainActor (Result<CapturedRoom, Error>) -> Void) -> RoomCaptureController {
        if let controller { return controller }
        let c = RoomCaptureController(onResult: onResult)
        controller = c
        return c
    }
}

private struct CaptureControls: View {
    @ObservedObject var controller: RoomCaptureController
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            switch controller.phase {
            case .processing:
                ProgressView("Building the room...")
                    .font(.title3.bold())
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            case .scanning, .idle:
                BigButton(title: "Done", systemImage: "checkmark.circle.fill", style: .primary) {
                    controller.finish()
                }
                Button("Cancel", role: .cancel, action: onCancel)
                    .font(.headline)
                    .foregroundStyle(.white)
            }
        }
        .padding(24)
    }
}

private struct RoomCaptureRepresentable: UIViewRepresentable {
    let captureView: RoomCaptureView

    func makeUIView(context: Context) -> RoomCaptureView { captureView }
    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}
