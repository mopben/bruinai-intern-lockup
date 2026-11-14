import simd
import XCTest
@testable import DryRunScan

final class ScanMapperTests: XCTestCase {
    private let tol = 0.0011

    // MARK: yaw convention: yaw = 0 means local +z faces world +z; positive yaw turns +z toward +x.

    func testSimdRotationAssumptionLocalZToWorldX() {
        // The convention the tests rely on: a +90 deg rotation about +y takes local +z to world +x.
        let m = makeTransform(yawDegrees: 90, translation: .zero)
        let z = m.columns.2
        XCTAssertEqual(z.x, 1, accuracy: 1e-5)
        XCTAssertEqual(z.z, 0, accuracy: 1e-5)
    }

    func testYawZero() {
        let scan = ScanMapper.map(makeInput(objects: [makeElement(yawDegrees: 0)]))
        XCTAssertEqual(scan.boxes[0].yaw, 0, accuracy: tol)
    }

    func testYaw90() {
        let scan = ScanMapper.map(makeInput(objects: [makeElement(yawDegrees: 90)]))
        XCTAssertEqual(scan.boxes[0].yaw, Double.pi / 2, accuracy: tol)
        XCTAssertEqual(scan.boxes[0].yaw, 1.571, accuracy: 1e-9)
    }

    func testYawMinus45() {
        let scan = ScanMapper.map(makeInput(objects: [makeElement(yawDegrees: -45)]))
        XCTAssertEqual(scan.boxes[0].yaw, -Double.pi / 4, accuracy: tol)
        XCTAssertEqual(scan.boxes[0].yaw, -0.785, accuracy: 1e-9)
    }

    func testYaw180IsPositivePi() {
        let scan = ScanMapper.map(makeInput(objects: [makeElement(yawDegrees: 180)]))
        XCTAssertEqual(abs(scan.boxes[0].yaw), Double.pi, accuracy: tol)
    }

    func testYawFallsBackToXAxisWhenZIsVertical() {
        // Local z pointing straight up (a 90 deg pitch) after a 30 deg yaw: use local x instead.
        let yawQ = simd_quatf(angle: .pi / 6, axis: SIMD3(0, 1, 0))
        let pitchQ = simd_quatf(angle: -.pi / 2, axis: SIMD3(1, 0, 0))
        let m = simd_float4x4(yawQ * pitchQ)
        XCTAssertEqual(ScanGeometry.yaw(m), Double.pi / 6, accuracy: 1e-4)
    }

    // MARK: translation and size

    func testCenterFromTranslationAndSizeFromDimensions() {
        let e = makeElement(size: SIMD3(1.234, 0.9, 0.567), yawDegrees: 30, at: SIMD3(1.5, 0.45, -2.25))
        let box = ScanMapper.map(makeInput(objects: [e])).boxes[0]
        XCTAssertEqual(box.center, Vec3(x: 1.5, y: 0.45, z: -2.25))
        XCTAssertEqual(box.size, BoxSize(w: 1.234, h: 0.9, d: 0.567))
    }

    func testRoundsToMillimetres() {
        let e = makeElement(size: SIMD3(1.23456, 0.9, 0.6), at: SIMD3(0.12345, 0.45, -0.00004))
        let box = ScanMapper.map(makeInput(objects: [e])).boxes[0]
        XCTAssertEqual(box.size.w, 1.235)
        XCTAssertEqual(box.center.x, 0.123)
        XCTAssertEqual(box.center.z, 0)
        XCTAssertEqual(box.center.z.sign, .plus, "no -0 in output")
    }

    // MARK: floor

    func testFloorNormalisedToLowestBottom() {
        // ARKit's origin is where the phone started, about 1.4 m above the floor.
        let table = makeElement("table", size: SIMD3(1, 0.9, 0.6), at: SIMD3(0, -0.95, 0))
        let fridge = makeElement("refrigerator", size: SIMD3(0.7, 1.8, 0.7), at: SIMD3(2, -0.5, 0))
        let wall = makeElement("wall", size: SIMD3(4, 2.4, 0), at: SIMD3(0, -0.2, -2))
        let scan = ScanMapper.map(makeInput(objects: [table, fridge], walls: [wall]))
        // Lowest bottom is the table and the fridge at -1.4.
        XCTAssertEqual(scan.boxes[0].center.y, 0.45, accuracy: 1e-9)
        XCTAssertEqual(scan.boxes[1].center.y, 0.9, accuracy: 1e-9)
        XCTAssertEqual(scan.walls[0].center.y, 1.2, accuracy: 1e-9)
    }

    func testFloorUsesWallIfLowerThanObjects() {
        let table = makeElement(size: SIMD3(1, 0.9, 0.6), at: SIMD3(0, 0.5, 0)) // bottom 0.05
        let wall = makeElement("wall", size: SIMD3(4, 2.4, 0), at: SIMD3(0, 1.2, -2)) // bottom 0
        let scan = ScanMapper.map(makeInput(objects: [table], walls: [wall]))
        XCTAssertEqual(scan.boxes[0].center.y, 0.5, accuracy: 1e-9)
    }

    // MARK: walls, ids, header

    func testWallsGetLengthHeightAndDefaultThickness() {
        let wall = makeElement("wall", size: SIMD3(4.5, 2.4, 0), yawDegrees: 90, at: SIMD3(-2.25, 1.2, 0))
        let w = ScanMapper.map(makeInput(objects: [], walls: [wall])).walls[0]
        XCTAssertEqual(w.id, "wall-1")
        XCTAssertEqual(w.size, BoxSize(w: 4.5, h: 2.4, d: ScanMapper.defaultWallThicknessM))
        XCTAssertEqual(w.yaw, 1.571, accuracy: 1e-9)
        XCTAssertEqual(w.center, Vec3(x: -2.25, y: 1.2, z: 0))
    }

    func testStableIdsCategoryAndHeader() {
        let scan = ScanMapper.map(makeInput(
            objects: [makeElement("table"), makeElement("storage", confidence: nil), makeElement("sink")],
            walls: [makeElement("wall", size: SIMD3(3, 2.4, 0)), makeElement("wall", size: SIMD3(3, 2.4, 0))]
        ))
        XCTAssertEqual(scan.boxes.map(\.id), ["box-1", "box-2", "box-3"])
        XCTAssertEqual(scan.boxes.map(\.category), ["table", "storage", "sink"])
        XCTAssertEqual(scan.walls.map(\.id), ["wall-1", "wall-2"])
        XCTAssertEqual(scan.boxes[1].confidence, nil)
        XCTAssertEqual(scan.format, "dryrun.scan")
        XCTAssertEqual(scan.version, 1)
        XCTAssertEqual(scan.units, "m")
        XCTAssertEqual(scan.source, "roomplan")
        XCTAssertEqual(scan.device, "iPhone17,1 iOS 27.2")
        XCTAssertEqual(scan.capturedAt, "2026-11-14T10:00:00Z")
    }

    func testEmptyCaptureIsValid() {
        let scan = ScanMapper.map(makeInput(objects: []))
        XCTAssertEqual(scan.boxes, [])
        XCTAssertEqual(scan.walls, [])
        XCTAssertNoThrow(try scan.validated())
    }
}
