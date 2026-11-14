import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("Dry Run Scan")
                .font(.largeTitle.bold())
            Text("Sweep the phone slowly around the counter, then send the scan to the laptop.")
                .font(.title3)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            if let message = model.errorMessage {
                Text(message)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            Spacer()

            if model.captureSupported {
                BigButton(title: "Start scan", systemImage: "viewfinder", style: .primary) {
                    model.startCapture()
                }
                BigButton(title: "Send sample scan instead", systemImage: "doc", style: .secondary) {
                    model.useSample()
                }
            } else {
                Text("This device cannot scan. RoomPlan needs an iPhone or iPad Pro with LiDAR.")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
                BigButton(title: "Send sample scan", systemImage: "doc", style: .primary) {
                    model.useSample()
                }
            }
        }
        .padding(24)
    }
}

/// A large, high-contrast button for use on stage.
struct BigButton: View {
    enum Style {
        case primary
        case secondary
    }

    let title: String
    let systemImage: String
    let style: Style
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.title2.bold())
                .frame(maxWidth: .infinity, minHeight: 64)
        }
        .buttonStyle(.borderedProminent)
        .tint(style == .primary ? .accentColor : .gray)
        .controlSize(.large)
    }
}
