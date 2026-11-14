import XCTest
@testable import DryRunScan

/// The JSON must match the Scan interfaces in src/core/types.ts key for key.
final class ScanJSONTests: XCTestCase {
    private func sampleScan() -> Scan {
        ScanMapper.map(makeInput(
            objects: [makeElement("table", yawDegrees: 90, at: SIMD3(1, 0.45, 2))],
            walls: [makeElement("wall", size: SIMD3(4, 2.4, 0), at: SIMD3(0, 1.2, -2))]
        ))
    }

    private func object(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testTopLevelKeysMatchTypesTs() throws {
        let json = try object(ScanJSON.encode(sampleScan()))
        XCTAssertEqual(Set(json.keys), ["format", "version", "units", "capturedAt", "source", "device", "walls", "boxes"])
        XCTAssertEqual(json["format"] as? String, "dryrun.scan")
        XCTAssertEqual(json["version"] as? Int, 1)
        XCTAssertEqual(json["units"] as? String, "m")
    }

    func testBoxAndWallKeysMatchTypesTs() throws {
        let json = try object(ScanJSON.encode(sampleScan()))
        let box = try XCTUnwrap((json["boxes"] as? [[String: Any]])?.first)
        XCTAssertEqual(Set(box.keys), ["id", "category", "center", "size", "yaw", "confidence"])
        XCTAssertEqual(Set(try XCTUnwrap(box["center"] as? [String: Any]).keys), ["x", "y", "z"])
        XCTAssertEqual(Set(try XCTUnwrap(box["size"] as? [String: Any]).keys), ["w", "h", "d"])
        XCTAssertEqual(box["confidence"] as? String, "high")

        let wall = try XCTUnwrap((json["walls"] as? [[String: Any]])?.first)
        XCTAssertEqual(Set(wall.keys), ["id", "center", "size", "yaw"])
    }

    func testOptionalFieldsAreOmittedNotNull() throws {
        let bare = Scan(
            format: ScanFormat.format, version: 1, units: "m", capturedAt: "2026-11-14T10:00:00Z",
            source: "roomplan", device: nil, walls: [],
            boxes: [ScanBox(id: "box-1", category: "table", center: Vec3(x: 0, y: 0.45, z: 0),
                            size: BoxSize(w: 1, h: 0.9, d: 0.6), yaw: 0, confidence: nil)]
        )
        let text = String(decoding: try ScanJSON.encode(bare), as: UTF8.self)
        XCTAssertFalse(text.contains("device"))
        XCTAssertFalse(text.contains("confidence"))
        XCTAssertFalse(text.contains("null"))
    }

    func testNumbersAreShortDecimals() throws {
        let text = String(decoding: try ScanJSON.encode(sampleScan()), as: UTF8.self)
        XCTAssertTrue(text.contains("\"yaw\" : 1.571"), text)
        XCTAssertFalse(text.contains("0000000"), "no float noise like 0.44999998")
    }

    func testRoundTrip() throws {
        let scan = sampleScan()
        XCTAssertEqual(try ScanJSON.decode(ScanJSON.encode(scan)), scan)
    }

    func testBundledSampleDecodesAndIsTheStagedCounter() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: AppModel.sampleResource, withExtension: "json"))
        let scan = try ScanJSON.decode(Data(contentsOf: url))
        XCTAssertEqual(scan.walls.count, 2)
        XCTAssertEqual(Set(scan.boxes.map(\.category)), ["table", "storage", "refrigerator", "sink", "chair", "unknown"])
        let summary = ScanSummary(scan: scan)
        XCTAssertEqual(summary.extentX, 4.5, accuracy: 0.3)
        XCTAssertEqual(summary.extentZ, 3.5, accuracy: 0.3)
    }

    func testValidationRejectsWrongFormat() {
        let data = Data(#"{"format":"other","version":1,"units":"m","capturedAt":"x","source":"manual","walls":[],"boxes":[]}"#.utf8)
        XCTAssertThrowsError(try ScanJSON.decode(data)) { error in
            XCTAssertEqual(error as? ScanValidationError, .wrongFormat("other"))
        }
    }
}
