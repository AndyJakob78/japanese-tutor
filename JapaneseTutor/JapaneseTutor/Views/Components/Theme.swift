import SwiftUI

/// Kotonome look: warm cream ground, white cards, coral accent (AccentColor), navy and leaf green.
// Color.appBackground and Color.cardBackground come from the asset catalog (generated symbols).

extension View {
    /// Cream background behind a whole screen (lists, forms and scroll views).
    func kotonomeScreen() -> some View {
        self
            .scrollContentBackground(.hidden)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.appBackground.ignoresSafeArea())
    }
}
