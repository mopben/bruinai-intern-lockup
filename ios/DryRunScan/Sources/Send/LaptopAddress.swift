import Foundation

/// Turns what the operator typed ("192.168.1.20", "franks-mac.local:5179", "http://10.0.0.5/")
/// into the scan endpoint URL. Pure, unit-tested.
enum LaptopAddress {
    static let defaultPort = 5179
    static let scanPath = "/api/scan"
    static let defaultsKey = "laptopAddress"

    enum ParseError: LocalizedError, Equatable {
        case empty
        case invalid(String)

        var errorDescription: String? {
            switch self {
            case .empty: return "Type the laptop address shown on the stage screen, e.g. 192.168.1.20."
            case .invalid(let s): return "\"\(s)\" is not an address. Use something like 192.168.1.20 or 192.168.1.20:5179."
            }
        }
    }

    static func scanURL(from typed: String) -> Result<URL, ParseError> {
        var s = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return .failure(.empty) }
        for prefix in ["http://", "https://"] where s.lowercased().hasPrefix(prefix) {
            s = String(s.dropFirst(prefix.count))
        }
        if let slash = s.firstIndex(of: "/") { s = String(s[..<slash]) }

        let parts = s.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 1 || parts.count == 2 else { return .failure(.invalid(typed)) }
        let host = String(parts[0])
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-"))
        guard !host.isEmpty, host.unicodeScalars.allSatisfy(allowed.contains) else {
            return .failure(.invalid(typed))
        }
        var port = defaultPort
        if parts.count == 2 {
            guard let p = Int(parts[1]), (1...65535).contains(p) else { return .failure(.invalid(typed)) }
            port = p
        }
        guard let url = URL(string: "http://\(host):\(port)\(scanPath)") else {
            return .failure(.invalid(typed))
        }
        return .success(url)
    }
}
