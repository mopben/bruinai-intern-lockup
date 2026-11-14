import Foundation

/// Encoding and decoding of scan.json. Keys sorted so output is stable and diffable.
enum ScanJSON {
    static func encode(_ scan: Scan) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(scan)
    }

    static func decode(_ data: Data) throws -> Scan {
        try JSONDecoder().decode(Scan.self, from: data).validated()
    }
}
