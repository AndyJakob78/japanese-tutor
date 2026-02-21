import SwiftUI

struct ArticleCard: View {
    let article: Article

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Title
            Text(stripMarkers(article.titleRomaji))
                .font(.headline)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            // Summary (short intro)
            if let summary = article.summaryRomaji {
                Text(stripMarkers(summary))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            // Metadata row — clean single line
            HStack(spacing: 6) {
                // Region flag
                if let region = article.region {
                    Text(regionFlag(region))
                        .font(.caption2)
                }

                // Category (short, not the full topic description)
                if let topic = article.topic {
                    Text(shortLabel(topic))
                        .font(.caption2)
                        .foregroundStyle(Color.accentColor)
                }

                // Date
                if let created = article.createdAt {
                    Text("· \(formatDate(created))")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Spacer()

                // New word count
                if let count = article.newWordCount, count > 0 {
                    Label("\(count) new", systemImage: "textformat.abc")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }

                // Quiz status
                if let score = article.quizScore {
                    Label("\(Int(score * 100))%", systemImage: "checkmark.circle")
                        .font(.caption2)
                        .foregroundStyle(score >= 0.7 ? .green : .orange)
                } else {
                    Label("Quiz", systemImage: "questionmark.circle")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    /// Shorten the topic to a readable label (max ~25 chars)
    private func shortLabel(_ topic: String) -> String {
        let words = topic.split(separator: " ")
        if words.count <= 3 && topic.count <= 25 {
            return topic.capitalized
        }
        let short = words.prefix(3).joined(separator: " ")
        if short.count > 25 {
            return String(short.prefix(22)) + "…"
        }
        return short.capitalized
    }

    private func regionFlag(_ region: String) -> String {
        switch region.lowercased() {
        case "germany": return "🇩🇪"
        case "japan": return "🇯🇵"
        case "us", "usa": return "🇺🇸"
        case "uk": return "🇬🇧"
        case "france": return "🇫🇷"
        case "china": return "🇨🇳"
        case "korea", "south korea": return "🇰🇷"
        default: return "🌍"
        }
    }

    private func formatDate(_ dateString: String) -> String {
        let parts = dateString.split(separator: "T")
        guard let datePart = parts.first else { return "" }
        let comps = datePart.split(separator: "-")
        guard comps.count == 3,
              let month = Int(comps[1]),
              let day = Int(comps[2]) else {
            return String(datePart)
        }
        let months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        guard month >= 1, month <= 12 else { return String(datePart) }
        return "\(months[month]) \(day)"
    }
}
