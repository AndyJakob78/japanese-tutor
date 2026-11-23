import SwiftUI

/// Small felt sheep in a screen corner (1.7, owner's wish: the sheep keeps you company).
/// Never blocks taps. An optional speech bubble shows for a few seconds, then fades.
struct CornerSheep: View {
    enum Pose: String {
        case peek = "CornerPeek", cross = "CornerCross", cheer = "CornerCheer"
        case lookDown = "CornerLookDown", comfort = "CornerComfort", wave = "CornerWave"
    }

    let pose: Pose
    var width: CGFloat = 86
    var bubble: String? = nil
    var bubbleOnLeading = true      // bubble beside the sheep, toward the middle of the screen
    var flipped = false
    var bubbleSeconds: Double = 3.5

    @State private var showBubble = true

    var body: some View {
        HStack(alignment: .top, spacing: 2) {
            if bubbleOnLeading { bubbleView }
            Image(pose.rawValue)
                .resizable()
                .scaledToFit()
                .frame(width: width)
                .scaleEffect(x: flipped ? -1 : 1)
                .id(pose)                       // new pose → small hop
                .transition(.scale(scale: 0.8).combined(with: .opacity))
            if !bubbleOnLeading { bubbleView }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.6), value: pose)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .task(id: bubble) {
            showBubble = true
            try? await Task.sleep(for: .seconds(bubbleSeconds))
            withAnimation(.easeOut(duration: 0.4)) { showBubble = false }
        }
    }

    @ViewBuilder private var bubbleView: some View {
        if let bubble, showBubble {
            Text(bubble)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.meadowNavy)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                // fixed light "paper note" colours: readable in dark mode too
                .background(Color(red: 1, green: 0.992, blue: 0.973), in: Capsule())
                .overlay(Capsule().stroke(Color.accentColor.opacity(0.7), lineWidth: 1.5))
                .fixedSize()
                .padding(.top, 8)
                .transition(.opacity)
        }
    }
}

extension CornerSheep {
    /// Quiz companion: hooves crossed while you choose, cheers when right, comforts when wrong.
    static func quiz(answered: Bool, correct: Bool) -> CornerSheep {
        if !answered { return CornerSheep(pose: .cross, bubble: L("Good luck!", "がんばって！")) }
        return correct
            ? CornerSheep(pose: .cheer, width: 92, bubble: L("Correct!", "せいかい！"))
            : CornerSheep(pose: .comfort, bubble: L("It's okay!", "だいじょうぶ！"))
    }
}
