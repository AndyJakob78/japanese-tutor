import SwiftUI

struct ArticleCard: View {
    let article: Article

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Title (romaji) — truncate to 2 lines
            Text(stripMarkers(article.titleRomaji))
                .font(.headline)
                .lineLimit(2)

            // Summary / English description — single line, truncated
            if let summary = article.summaryRomaji {
                Text(stripMarkers(summary))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            // Metadata row: region + topic + date
            HStack(spacing: 4) {
                if let region = article.region {
                    Text(regionFlag(region))
                        .font(.caption)
                }

                if let topic = article.topic {
                    Text(shortLabel(topic))
                        .font(.caption)
                        .foregroundStyle(Color.accentColor)
                }

                if let created = article.createdAt {
                    Text("·")
                        .font(.caption)
                        .foregroundStyle(.quaternary)
                    Text(formatDate(created))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }

                Spacer()
            }

            // Stats row: new words + quiz status
            HStack(spacing: 12) {
                if let count = article.newWordCount, count > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "character.book.closed")
                            .font(.system(size: 10))
                        Text("\(count) new words")
                            .font(.caption)
                    }
                    .foregroundStyle(.orange)
                }

                if let reviewCount = article.reviewWordCount, reviewCount > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "arrow.trianglehead.2.counterclockwise")
                            .font(.system(size: 10))
                        Text("\(reviewCount) review")
                            .font(.caption)
                    }
                    .foregroundStyle(.blue)
                }

                Spacer()

                if let score = article.quizScore {
                    HStack(spacing: 3) {
                        Image(systemName: score >= 0.7 ? "checkmark.circle.fill" : "circle.dotted")
                            .font(.system(size: 10))
                        Text("\(Int(score * 100))%")
                            .font(.caption.weight(.medium))
                    }
                    .foregroundStyle(score >= 0.7 ? .green : .orange)
                }
            }
        }
        .padding(.vertical, 6)
    }

    /// Shorten the topic to a readable label (max ~20 chars)
    private func shortLabel(_ topic: String) -> String {
        let words = topic.split(separator: " ")
        if words.count <= 3 && topic.count <= 20 {
            return topic.capitalized
        }
        let short = words.prefix(2).joined(separator: " ")
        if short.count > 20 {
            return String(short.prefix(17)) + "..."
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
        case "australia": return "🇦🇺"
        case "canada": return "🇨🇦"
        case "india": return "🇮🇳"
        case "brazil": return "🇧🇷"
        case "spain": return "🇪🇸"
        case "italy": return "🇮🇹"
        case "mexico": return "🇲🇽"
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
