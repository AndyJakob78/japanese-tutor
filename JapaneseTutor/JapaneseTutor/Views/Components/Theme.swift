import SwiftUI

/// Kotonome look: warm cream ground, white cards, coral accent (AccentColor), navy and leaf green.
// Color.appBackground and Color.cardBackground come from the asset catalog (generated symbols).

extension Color {
    /// The accent for SMALL text: the normal coral is too light on cream at caption size,
    /// so light mode uses a darker coral; dark mode keeps the accent.
    static let accentText = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(Color.accentColor) : UIColor(red: 0.75, green: 0.29, blue: 0.17, alpha: 1)
    })
}

extension View {
    /// Cream background behind a whole screen (lists, forms and scroll views).
    func kotonomeScreen() -> some View {
        self
            .scrollContentBackground(.hidden)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.appBackground.ignoresSafeArea())
    }
}
