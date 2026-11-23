import CoreLocation
import Foundation

/// Suggests places for the news: from the time zone (no permission needed),
/// or once from the phone's approximate location when the learner taps "Use my location".
/// Only the place NAME (city, state, country) is kept — never coordinates.
@MainActor
final class PlaceFinder: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?

    /// "New York", "United States" from America/New_York and the phone's region.
    static func timeZoneSuggestions() -> [String] {
        var out: [String] = []
        let id = TimeZone.current.identifier
        if let city = id.split(separator: "/").last, id.contains("/"), !id.hasPrefix("Etc") {
            out.append(city.replacingOccurrences(of: "_", with: " "))
        }
        if let region = Locale.current.region?.identifier,
           let country = Locale(identifier: "en_US").localizedString(forRegionCode: region) {
            out.append(country)
        }
        return out
    }

    /// City, state / prefecture and country of where the phone is now (approximate).
    func currentPlaces() async -> [String] {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
        guard let location = await requestLocation() else { return [] }
        let geocoder = CLGeocoder()
        guard let mark = try? await geocoder.reverseGeocodeLocation(location, preferredLocale: Locale(identifier: "en_US")).first else { return [] }
        // state codes like "NY" or "CA" make poor search words — keep only full names
        let state = mark.administrativeArea.flatMap { $0.count > 3 ? $0 : nil }
        return [mark.locality, state, mark.country].compactMap { $0 }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
    }

    private func requestLocation() async -> CLLocation? {
        await withCheckedContinuation { cont in
            continuation = cont
            switch manager.authorizationStatus {
            case .notDetermined: manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            default: finish(nil)
            }
        }
    }

    private func finish(_ location: CLLocation?) {
        continuation?.resume(returning: location)
        continuation = nil
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard continuation != nil else { return }
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            case .notDetermined: break
            default: finish(nil)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in finish(locations.last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in finish(nil) }
    }
}
