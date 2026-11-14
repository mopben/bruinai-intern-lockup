import Foundation
import simd
@testable import DryRunScan

/// Element-to-world transform built with simd's own right-handed rotation about +y,
/// so tests do not depend on the code under test to build their inputs.
func makeTransform(yawDegrees: Float, translation t: SIMD3<Float>) -> simd_float4x4 {
    let q = simd_quatf(angle: yawDegrees * .pi / 180, axis: SIMD3<Float>(0, 1, 0))
    var m = simd_float4x4(q)
    m.columns.3 = SIMD4<Float>(t.x, t.y, t.z, 1)
    return m
}

func makeElement(
    _ category: String = "table",
    size: SIMD3<Float> = SIMD3(1, 0.9, 0.6),
    yawDegrees: Float = 0,
    at t: SIMD3<Float> = SIMD3(0, 0.45, 0),
    confidence: ScanConfidence? = .high
) -> DetectedElement {
    DetectedElement(
        category: category,
        dimensions: size,
        transform: makeTransform(yawDegrees: yawDegrees, translation: t),
        confidence: confidence
    )
}

func makeInput(objects: [DetectedElement], walls: [DetectedElement] = []) -> CaptureInput {
    CaptureInput(
        objects: objects,
        walls: walls,
        capturedAt: Date(timeIntervalSince1970: 1_794_650_400), // 2026-11-14T10:00:00Z
        device: "iPhone17,1 iOS 27.2"
    )
}
