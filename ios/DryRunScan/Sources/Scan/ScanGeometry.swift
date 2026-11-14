import Foundation
import simd

/// Pure helpers for turning a RoomPlan-style 4x4 transform into our centre + yaw.
enum ScanGeometry {
    /// Below this horizontal length an axis is treated as vertical (degenerate for yaw).
    static let degenerateAxisLength: Float = 1e-4

    /// World position of the element's centre: the translation column.
    static func translation(_ m: simd_float4x4) -> SIMD3<Double> {
        SIMD3(Double(m.columns.3.x), Double(m.columns.3.y), Double(m.columns.3.z))
    }

    /// Rotation about world +y, in (-pi, pi].
    ///
    /// A rotation by yaw about +y (right-handed, y up) maps local +z to (sin yaw, 0, cos yaw)
    /// and local +x to (cos yaw, 0, -sin yaw). So yaw = atan2(z.x, z.z) from the transform's
    /// third column, falling back to the first column if local z is (nearly) vertical.
    static func yaw(_ m: simd_float4x4) -> Double {
        let z = m.columns.2
        if hypot(z.x, z.z) > degenerateAxisLength {
            return normalizedAngle(atan2(Double(z.x), Double(z.z)))
        }
        let x = m.columns.0
        return normalizedAngle(atan2(Double(-x.z), Double(x.x)))
    }

    /// Maps any angle into (-pi, pi].
    static func normalizedAngle(_ a: Double) -> Double {
        var r = a.truncatingRemainder(dividingBy: 2 * .pi)
        if r <= -.pi { r += 2 * .pi }
        if r > .pi { r -= 2 * .pi }
        return r
    }

    /// Rounds to 3 decimals (millimetres for lengths) and turns -0 into 0.
    static func roundMM(_ v: Double) -> Double {
        let r = (v * 1000).rounded() / 1000
        return r == 0 ? 0 : r
    }

    /// Floor-plan corners (x, z) of a box of footprint w x d, centred at (cx, cz), rotated by yaw.
    static func footprintCorners(cx: Double, cz: Double, w: Double, d: Double, yaw: Double) -> [SIMD2<Double>] {
        let ax = SIMD2(cos(yaw), -sin(yaw)) * (w / 2)  // local +x in world (x, z)
        let az = SIMD2(sin(yaw), cos(yaw)) * (d / 2)   // local +z in world (x, z)
        let c = SIMD2(cx, cz)
        return [c + ax + az, c + ax - az, c - ax + az, c - ax - az]
    }
}
