import Foundation
import RoomPlan
import UIKit

/// Owns one RoomPlan capture: the standard RoomCaptureView with Apple's coaching UI.
/// Flow: start() -> user sweeps -> finish() stops the session -> RoomPlan processes
/// and calls captureView(didPresent:error:) with the final CapturedRoom.
final class RoomCaptureController: NSObject, ObservableObject, RoomCaptureViewDelegate {
    enum Phase: Equatable {
        case idle
        case scanning
        case processing
    }

    static var isSupported: Bool { RoomCaptureSession.isSupported }

    @MainActor @Published private(set) var phase: Phase = .idle

    @MainActor let captureView: RoomCaptureView
    private let onResult: @MainActor (Result<CapturedRoom, Error>) -> Void

    @MainActor
    init(onResult: @escaping @MainActor (Result<CapturedRoom, Error>) -> Void) {
        self.captureView = RoomCaptureView(frame: .zero)
        self.onResult = onResult
        super.init()
        captureView.delegate = self
    }

    // RoomCaptureViewDelegate inherits NSCoding. This controller is never archived.
    required init?(coder: NSCoder) { nil }
    func encode(with coder: NSCoder) {}

    @MainActor
    func start() {
        guard phase == .idle else { return }
        var config = RoomCaptureSession.Configuration()
        config.isCoachingEnabled = true
        captureView.captureSession.run(configuration: config)
        UIApplication.shared.isIdleTimerDisabled = true
        phase = .scanning
    }

    /// The big Done button. RoomPlan then builds the final room and calls didPresent.
    @MainActor
    func finish() {
        guard phase == .scanning else { return }
        phase = .processing
        captureView.captureSession.stop()
    }

    @MainActor
    func cancel() {
        if phase == .scanning { captureView.captureSession.stop() }
        UIApplication.shared.isIdleTimerDisabled = false
        phase = .idle
    }

    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        Task { @MainActor in
            UIApplication.shared.isIdleTimerDisabled = false
            // Also reached from .scanning if RoomPlan ends the session itself (e.g. tracking lost).
            guard self.phase != .idle else { return }
            self.phase = .idle
            if let error {
                self.onResult(.failure(error))
            } else {
                self.onResult(.success(processedResult))
            }
        }
    }
}
