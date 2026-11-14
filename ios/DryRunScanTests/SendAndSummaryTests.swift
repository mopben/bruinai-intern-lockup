import XCTest
@testable import DryRunScan

final class LaptopAddressTests: XCTestCase {
    private func url(_ s: String) -> String? {
        try? LaptopAddress.scanURL(from: s).get().absoluteString
    }

    func testDefaultsPort5179() {
        XCTAssertEqual(url("192.168.1.20"), "http://192.168.1.20:5179/api/scan")
        XCTAssertEqual(url("  franks-mac.local \n"), "http://franks-mac.local:5179/api/scan")
    }

    func testKeepsExplicitPortAndStripsSchemeAndPath() {
        XCTAssertEqual(url("10.0.0.5:8080"), "http://10.0.0.5:8080/api/scan")
        XCTAssertEqual(url("http://10.0.0.5:5179/"), "http://10.0.0.5:5179/api/scan")
        XCTAssertEqual(url("HTTP://10.0.0.5/api/scan"), "http://10.0.0.5:5179/api/scan")
    }

    func testRejectsBadInput() {
        XCTAssertEqual(LaptopAddress.scanURL(from: "   ").failureValue, .empty)
        XCTAssertNotNil(LaptopAddress.scanURL(from: "1.2.3.4:abc").failureValue)
        XCTAssertNotNil(LaptopAddress.scanURL(from: "1.2.3.4:99999").failureValue)
        XCTAssertNotNil(LaptopAddress.scanURL(from: "my laptop").failureValue)
    }
}

final class UploadInterpretTests: XCTestCase {
    func testSuccessReply() {
        let body = Data(#"{"success":true,"data":{"boxes":7}}"#.utf8)
        guard case .success = ScanUploader.interpret(status: 200, body: body) else { return XCTFail() }
    }

    func testServerErrorIsShown() {
        let body = Data(#"{"success":false,"error":"boxes[2].size.w must be positive"}"#.utf8)
        let outcome = ScanUploader.interpret(status: 400, body: body)
        guard case .failure(let message) = outcome else { return XCTFail() }
        XCTAssertTrue(message.contains("boxes[2].size.w must be positive"))
        XCTAssertTrue(message.contains("400"))
    }

    func testNonJSONReply() {
        guard case .failure(let m) = ScanUploader.interpret(status: 404, body: Data("Not Found".utf8)) else {
            return XCTFail()
        }
        XCTAssertTrue(m.contains("404"))
    }
}

final class ScanSummaryTests: XCTestCase {
    func testCountsAndExtent() {
        let scan = ScanMapper.map(makeInput(
            objects: [
                makeElement("table", size: SIMD3(1, 0.9, 0.6), at: SIMD3(-1, 0.45, 0)),
                makeElement("table", size: SIMD3(1, 0.9, 0.6), at: SIMD3(1, 0.45, 0)),
                // Rotated 90 deg: its 2 m width now runs along z.
                makeElement("storage", size: SIMD3(2, 0.9, 0.4), yawDegrees: 90, at: SIMD3(0, 0.45, 1)),
            ]
        ))
        let s = ScanSummary(scan: scan)
        XCTAssertEqual(s.objectCount, 3)
        XCTAssertEqual(s.wallCount, 0)
        XCTAssertEqual(s.extentX, 3.0, accuracy: 0.002)  // -1.5 ... 1.5
        XCTAssertEqual(s.extentZ, 2.3, accuracy: 0.002)  // -0.3 ... 2.0
        XCTAssertEqual(s.categoryCounts.first, .init(category: "table", count: 2))
        XCTAssertEqual(s.headline, "3 objects, 0 walls, 3.0 m x 2.3 m")
    }
}

private extension Result {
    var failureValue: Failure? {
        if case .failure(let f) = self { return f }
        return nil
    }
}
