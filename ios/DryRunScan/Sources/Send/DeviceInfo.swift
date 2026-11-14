import Foundation
import UIKit

enum DeviceInfo {
    /// e.g. "iPhone17,1 iOS 27.2" or "iPhone18,1 (simulator) iOS 27.2".
    static func description() -> String {
        let env = ProcessInfo.processInfo.environment
        let model: String
        if let sim = env["SIMULATOR_MODEL_IDENTIFIER"] {
            model = "\(sim) (simulator)"
        } else {
            model = hardwareIdentifier()
        }
        return "\(model) iOS \(UIDevice.current.systemVersion)"
    }

    private static func hardwareIdentifier() -> String {
        var info = utsname()
        uname(&info)
        let mirror = Mirror(reflecting: info.machine)
        let chars = mirror.children.compactMap { $0.value as? Int8 }.prefix { $0 != 0 }
        let id = String(decoding: chars.map { UInt8(bitPattern: $0) }, as: UTF8.self)
        return id.isEmpty ? UIDevice.current.model : id
    }
}
