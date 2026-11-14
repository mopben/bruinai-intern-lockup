import Foundation

// Mirrors the Scan section of src/core/types.ts exactly (field names and nesting).
// Units: metres and radians. Floor frame: x right, y up, z toward the viewer.
// yaw is a rotation about +y; yaw = 0 means the box's local +z ("front") faces world +z.

enum ScanFormat {
    static let format = "dryrun.scan"
    static let version = 1
    static let units = "m"
}

struct Vec3: Codable, Equatable {
    let x: Double
    let y: Double
    let z: Double
}

/// w runs along the box's local x axis, h is up, d runs along local z.
struct BoxSize: Codable, Equatable {
    let w: Double
    let h: Double
    let d: Double
}

enum ScanConfidence: String, Codable, Equatable {
    case low
    case medium
    case high
}

struct ScanBox: Codable, Equatable {
    let id: String
    let category: String
    let center: Vec3
    let size: BoxSize
    let yaw: Double
    let confidence: ScanConfidence?
}

struct ScanWall: Codable, Equatable {
    let id: String
    let center: Vec3
    /// w is the wall length, h its height, d its thickness.
    let size: BoxSize
    let yaw: Double
}

struct Scan: Codable, Equatable {
    let format: String
    let version: Int
    let units: String
    let capturedAt: String
    /// "roomplan" | "manual" | "synthetic"
    let source: String
    let device: String?
    let walls: [ScanWall]
    let boxes: [ScanBox]
}

enum ScanValidationError: LocalizedError, Equatable {
    case wrongFormat(String)
    case wrongVersion(Int)
    case wrongUnits(String)
    case badSize(String)

    var errorDescription: String? {
        switch self {
        case .wrongFormat(let f): return "Not a Dry Run scan (format \"\(f)\")."
        case .wrongVersion(let v): return "Unsupported scan version \(v)."
        case .wrongUnits(let u): return "Scan units must be metres, got \"\(u)\"."
        case .badSize(let id): return "Item \(id) has a negative or non-finite size."
        }
    }
}

extension Scan {
    /// Checks the header fields and sizes. Used on the bundled sample before sending it.
    func validated() throws -> Scan {
        guard format == ScanFormat.format else { throw ScanValidationError.wrongFormat(format) }
        guard version == ScanFormat.version else { throw ScanValidationError.wrongVersion(version) }
        guard units == ScanFormat.units else { throw ScanValidationError.wrongUnits(units) }
        let sized = boxes.map { ($0.id, $0.size) } + walls.map { ($0.id, $0.size) }
        for (id, s) in sized where ![s.w, s.h, s.d].allSatisfy({ $0.isFinite && $0 >= 0 }) {
            throw ScanValidationError.badSize(id)
        }
        return self
    }
}
