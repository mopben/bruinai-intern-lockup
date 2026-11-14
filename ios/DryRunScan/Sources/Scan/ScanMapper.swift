import Foundation
import simd

/// One detected element, as RoomPlan reports it. RoomPlan's `CapturedRoom.Object` and
/// `CapturedRoom.Surface` cannot be constructed in tests, so they are adapted into this
/// (see RoomPlanAdapter.swift) and everything below is pure.
struct DetectedElement: Equatable {
    /// RoomPlan category case name, e.g. "table". Ignored for walls.
    let category: String
    /// RoomPlan `dimensions`: x = width (local x), y = height, z = depth (local z).
    let dimensions: SIMD3<Float>
    /// RoomPlan `transform`: element-to-world, ARKit world (right-handed, y up, metres).
    let transform: simd_float4x4
    let confidence: ScanConfidence?
}

struct CaptureInput: Equatable {
    let objects: [DetectedElement]
    let walls: [DetectedElement]
    let capturedAt: Date
    let device: String?
}

enum ScanMapper {
    /// RoomPlan reports walls as zero-thickness planes. Give them this thickness so they draw.
    static let defaultWallThicknessM: Double = 0.1
    static let source = "roomplan"

    static func map(_ input: CaptureInput) -> Scan {
        let floorY = floorHeight(input.objects + input.walls)
        let boxes = input.objects.enumerated().map { i, e in
            box(e, id: "box-\(i + 1)", floorY: floorY)
        }
        let walls = input.walls.enumerated().map { i, e in
            wall(e, id: "wall-\(i + 1)", floorY: floorY)
        }
        return Scan(
            format: ScanFormat.format,
            version: ScanFormat.version,
            units: ScanFormat.units,
            capturedAt: isoString(input.capturedAt),
            source: source,
            device: input.device,
            walls: walls,
            boxes: boxes
        )
    }

    /// Lowest bottom (centre.y - height/2) of all elements; 0 if there are none.
    static func floorHeight(_ elements: [DetectedElement]) -> Double {
        elements
            .map { ScanGeometry.translation($0.transform).y - Double($0.dimensions.y) / 2 }
            .min() ?? 0
    }

    static func isoString(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: date)
    }

    private static func center(_ e: DetectedElement, floorY: Double) -> Vec3 {
        let t = ScanGeometry.translation(e.transform)
        return Vec3(
            x: ScanGeometry.roundMM(t.x),
            y: ScanGeometry.roundMM(t.y - floorY),
            z: ScanGeometry.roundMM(t.z)
        )
    }

    private static func box(_ e: DetectedElement, id: String, floorY: Double) -> ScanBox {
        ScanBox(
            id: id,
            category: e.category,
            center: center(e, floorY: floorY),
            size: BoxSize(
                w: ScanGeometry.roundMM(Double(e.dimensions.x)),
                h: ScanGeometry.roundMM(Double(e.dimensions.y)),
                d: ScanGeometry.roundMM(Double(e.dimensions.z))
            ),
            yaw: ScanGeometry.roundMM(ScanGeometry.yaw(e.transform)),
            confidence: e.confidence
        )
    }

    private static func wall(_ e: DetectedElement, id: String, floorY: Double) -> ScanWall {
        let thickness = Double(e.dimensions.z) > 0 ? Double(e.dimensions.z) : defaultWallThicknessM
        return ScanWall(
            id: id,
            center: center(e, floorY: floorY),
            size: BoxSize(
                w: ScanGeometry.roundMM(Double(e.dimensions.x)),
                h: ScanGeometry.roundMM(Double(e.dimensions.y)),
                d: ScanGeometry.roundMM(thickness)
            ),
            yaw: ScanGeometry.roundMM(ScanGeometry.yaw(e.transform))
        )
    }
}
