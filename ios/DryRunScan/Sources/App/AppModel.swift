import Foundation
import RoomPlan

/// A scan ready to send: the model, its exact JSON bytes, and a scan.json file for sharing.
struct PreparedScan: Equatable {
    enum Origin: Equatable {
        case capture
        case sample
    }

    let scan: Scan
    let json: Data
    let fileURL: URL
    let summary: ScanSummary
    let origin: Origin

    static func make(_ scan: Scan, origin: Origin) throws -> PreparedScan {
        let json = try ScanJSON.encode(scan)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("scan.json")
        try json.write(to: url, options: .atomic)
        return PreparedScan(scan: scan, json: json, fileURL: url, summary: ScanSummary(scan: scan), origin: origin)
    }
}

enum SendState: Equatable {
    case idle
    case sending
    case done(UploadOutcome)
}

@MainActor
final class AppModel: ObservableObject {
    enum Screen: Equatable {
        case home
        case capture
        case review
    }

    nonisolated static let sampleResource = "sample-scan"

    @Published private(set) var screen: Screen = .home
    @Published private(set) var prepared: PreparedScan?
    @Published private(set) var sendState: SendState = .idle
    @Published var errorMessage: String?
    @Published var address: String {
        didSet { defaults.set(address, forKey: LaptopAddress.defaultsKey) }
    }

    let captureSupported: Bool
    private let defaults: UserDefaults
    private let uploader: ScanUploader

    init(defaults: UserDefaults = .standard, uploader: ScanUploader = ScanUploader()) {
        self.defaults = defaults
        self.uploader = uploader
        self.address = defaults.string(forKey: LaptopAddress.defaultsKey) ?? ""
        self.captureSupported = RoomCaptureController.isSupported
    }

    func startCapture() {
        errorMessage = nil
        screen = .capture
    }

    func cancelCapture() {
        screen = prepared == nil ? .home : .review
    }

    func captureFinished(_ result: Result<CapturedRoom, Error>) {
        switch result {
        case .failure(let error):
            errorMessage = "The scan did not finish: \(error.localizedDescription) Try again, slowly."
            screen = .home
        case .success(let room):
            let input = RoomPlanAdapter.input(from: room, capturedAt: Date(), device: DeviceInfo.description())
            show(ScanMapper.map(input), origin: .capture)
        }
    }

    func useSample() {
        errorMessage = nil
        do {
            guard let url = Bundle.main.url(forResource: Self.sampleResource, withExtension: "json") else {
                throw CocoaError(.fileNoSuchFile)
            }
            let scan = try ScanJSON.decode(Data(contentsOf: url))
            show(scan, origin: .sample)
        } catch {
            errorMessage = "The bundled sample scan could not be loaded: \(error.localizedDescription)"
        }
    }

    func backHome() {
        sendState = .idle
        screen = .home
    }

    func send() async {
        guard let prepared else { return }
        switch LaptopAddress.scanURL(from: address) {
        case .failure(let error):
            sendState = .done(.failure(error.localizedDescription))
        case .success(let url):
            sendState = .sending
            sendState = .done(await uploader.send(prepared.json, to: url))
        }
    }

    private func show(_ scan: Scan, origin: PreparedScan.Origin) {
        do {
            prepared = try PreparedScan.make(scan, origin: origin)
            sendState = .idle
            screen = .review
        } catch {
            errorMessage = "Could not write scan.json: \(error.localizedDescription)"
            screen = .home
        }
    }
}
