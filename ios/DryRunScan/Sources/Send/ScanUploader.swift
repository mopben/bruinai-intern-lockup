import Foundation

/// The outcome of one POST, in words the operator can act on.
enum UploadOutcome: Equatable {
    case success(String)
    case failure(String)
}

/// POSTs scan.json to the laptop. The server replies `{ success, data?, error? }`.
struct ScanUploader {
    static let timeoutSeconds: TimeInterval = 8

    let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func send(_ body: Data, to url: URL) async -> UploadOutcome {
        var request = URLRequest(url: url, timeoutInterval: Self.timeoutSeconds)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            return Self.interpret(status: status, body: data)
        } catch {
            return .failure(Self.describe(error, url: url))
        }
    }

    private struct Reply: Decodable {
        let success: Bool
        let error: String?
    }

    /// Pure: turns an HTTP status and body into an outcome. Unit-tested.
    static func interpret(status: Int, body: Data) -> UploadOutcome {
        let reply = try? JSONDecoder().decode(Reply.self, from: body)
        if let reply {
            if reply.success && (200..<300).contains(status) {
                return .success("Sent. The laptop accepted the scan.")
            }
            let why = reply.error ?? "no reason given"
            return .failure("The laptop refused the scan (HTTP \(status)): \(why)")
        }
        if status == 404 {
            return .failure("The laptop answered but has no /api/scan (HTTP 404). Is the Dry Run server running?")
        }
        return .failure("The laptop gave an unexpected answer (HTTP \(status)).")
    }

    static func describe(_ error: Error, url: URL) -> String {
        let host = "\(url.host ?? "?"):\(url.port ?? LaptopAddress.defaultPort)"
        guard let urlError = error as? URLError else {
            return "Could not send to \(host): \(error.localizedDescription)"
        }
        switch urlError.code {
        case .timedOut:
            return "No answer from \(host) in \(Int(timeoutSeconds)) s. Same Wi-Fi? Server running?"
        case .cannotConnectToHost:
            return "\(host) refused the connection. Is the Dry Run server running on the laptop?"
        case .cannotFindHost, .dnsLookupFailed:
            return "Cannot find \(host). Check the address on the stage screen."
        case .notConnectedToInternet, .networkConnectionLost:
            return "The phone is not on a network. Join the same Wi-Fi as the laptop."
        default:
            return "Could not send to \(host): \(urlError.localizedDescription)"
        }
    }
}
