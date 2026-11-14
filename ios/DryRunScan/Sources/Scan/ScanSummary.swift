import Foundation

/// What the operator sees after capture, to judge whether the scan is sane before sending.
struct ScanSummary: Equatable {
    let objectCount: Int
    let wallCount: Int
    /// Floor extent along x and z, in metres, over every box and wall footprint. 0 if empty.
    let extentX: Double
    let extentZ: Double
    /// e.g. [("table", 3), ("storage", 1)], most common first, then by name.
    let categoryCounts: [CategoryCount]

    struct CategoryCount: Equatable {
        let category: String
        let count: Int
    }

    init(scan: Scan) {
        objectCount = scan.boxes.count
        wallCount = scan.walls.count

        let corners = scan.boxes.flatMap {
            ScanGeometry.footprintCorners(cx: $0.center.x, cz: $0.center.z, w: $0.size.w, d: $0.size.d, yaw: $0.yaw)
        } + scan.walls.flatMap {
            ScanGeometry.footprintCorners(cx: $0.center.x, cz: $0.center.z, w: $0.size.w, d: $0.size.d, yaw: $0.yaw)
        }
        let xs = corners.map(\.x)
        let zs = corners.map(\.y)
        extentX = ScanGeometry.roundMM((xs.max() ?? 0) - (xs.min() ?? 0))
        extentZ = ScanGeometry.roundMM((zs.max() ?? 0) - (zs.min() ?? 0))

        let grouped = Dictionary(grouping: scan.boxes, by: \.category).mapValues(\.count)
        categoryCounts = grouped
            .map { CategoryCount(category: $0.key, count: $0.value) }
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.category < $1.category }
    }

    /// One line, e.g. "7 objects, 2 walls, 4.5 m x 3.5 m".
    var headline: String {
        let objects = objectCount == 1 ? "1 object" : "\(objectCount) objects"
        let walls = wallCount == 1 ? "1 wall" : "\(wallCount) walls"
        return "\(objects), \(walls), \(Self.metres(extentX)) x \(Self.metres(extentZ))"
    }

    var categoriesLine: String {
        categoryCounts.map { "\($0.count) \($0.category)" }.joined(separator: ", ")
    }

    static func metres(_ v: Double) -> String {
        String(format: "%.1f m", v)
    }
}
