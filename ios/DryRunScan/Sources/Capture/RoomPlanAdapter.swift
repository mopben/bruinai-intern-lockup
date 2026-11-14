import Foundation
import RoomPlan

/// The only place RoomPlan types touch the mapping. Kept trivial on purpose:
/// it copies fields into DetectedElement and does no geometry.
/// Doors, windows, openings and floors are skipped; the stage only needs objects and walls.
enum RoomPlanAdapter {
    static func input(from room: CapturedRoom, capturedAt: Date, device: String?) -> CaptureInput {
        CaptureInput(
            objects: room.objects.map { object in
                DetectedElement(
                    category: categoryName(object.category),
                    dimensions: object.dimensions,
                    transform: object.transform,
                    confidence: confidence(object.confidence)
                )
            },
            walls: room.walls.map { wall in
                DetectedElement(
                    category: "wall",
                    dimensions: wall.dimensions,
                    transform: wall.transform,
                    confidence: confidence(wall.confidence)
                )
            },
            capturedAt: capturedAt,
            device: device
        )
    }

    /// RoomPlan's case name, verbatim (checked against the iOS 27.2 SDK swiftinterface).
    static func categoryName(_ c: CapturedRoom.Object.Category) -> String {
        switch c {
        case .storage: return "storage"
        case .refrigerator: return "refrigerator"
        case .stove: return "stove"
        case .bed: return "bed"
        case .sink: return "sink"
        case .washerDryer: return "washerDryer"
        case .toilet: return "toilet"
        case .bathtub: return "bathtub"
        case .oven: return "oven"
        case .dishwasher: return "dishwasher"
        case .table: return "table"
        case .sofa: return "sofa"
        case .chair: return "chair"
        case .fireplace: return "fireplace"
        case .television: return "television"
        case .stairs: return "stairs"
        @unknown default: return "unknown"
        }
    }

    static func confidence(_ c: CapturedRoom.Confidence) -> ScanConfidence? {
        switch c {
        case .low: return .low
        case .medium: return .medium
        case .high: return .high
        @unknown default: return nil
        }
    }
}
