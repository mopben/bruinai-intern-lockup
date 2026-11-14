import SwiftUI

/// After capture (or after picking the sample): is the scan sane, then send it.
struct ReviewView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let prepared = model.prepared {
                    SummaryCard(prepared: prepared)
                    AddressField(address: $model.address)
                    SendSection(state: model.sendState) {
                        Task { await model.send() }
                    }
                    ShareLink(item: prepared.fileURL) {
                        Label("Share scan.json (AirDrop / Files)", systemImage: "square.and.arrow.up")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.bordered)
                    Text("If sending fails, share the file and drop it on the stage screen.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Button("Back to start") { model.backHome() }
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
            }
            .padding(24)
        }
    }
}

private struct SummaryCard: View {
    let prepared: PreparedScan

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Scan ready").font(.title.bold())
                if prepared.origin == .sample {
                    Text("SAMPLE")
                        .font(.caption.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.orange, in: Capsule())
                        .foregroundStyle(.white)
                }
            }
            Text(prepared.summary.headline)
                .font(.title3.weight(.semibold))
                .accessibilityIdentifier("summaryHeadline")
            if !prepared.summary.categoriesLine.isEmpty {
                Text(prepared.summary.categoriesLine)
                    .foregroundStyle(.secondary)
            }
            if prepared.summary.objectCount == 0 {
                Text("No objects found. Scan again, closer and slower.")
                    .foregroundStyle(.red)
                    .font(.headline)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct AddressField: View {
    @Binding var address: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Laptop address (shown on the stage screen)")
                .font(.headline)
            TextField("192.168.1.20", text: $address)
                .textFieldStyle(.roundedBorder)
                .font(.title3.monospaced())
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("addressField")
            Text("Port \(String(LaptopAddress.defaultPort)) is used unless you add one, e.g. 192.168.1.20:5179.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

private struct SendSection: View {
    let state: SendState
    let onSend: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            BigButton(title: buttonTitle, systemImage: "paperplane.fill", style: .primary, action: onSend)
                .disabled(state == .sending)
            status
        }
    }

    private var buttonTitle: String {
        switch state {
        case .idle: return "Send to laptop"
        case .sending: return "Sending..."
        case .done(.success): return "Send again"
        case .done(.failure): return "Retry"
        }
    }

    @ViewBuilder private var status: some View {
        switch state {
        case .idle, .sending:
            EmptyView()
        case .done(.success(let message)):
            Label(message, systemImage: "checkmark.circle.fill")
                .font(.title3.bold())
                .foregroundStyle(.green)
        case .done(.failure(let message)):
            Label(message, systemImage: "xmark.octagon.fill")
                .font(.headline)
                .foregroundStyle(.red)
        }
    }
}
