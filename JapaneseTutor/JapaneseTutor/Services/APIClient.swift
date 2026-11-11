import Foundation
import UIKit

/// API client for communicating with the Japanese Tutor backend.
/// Uses async/await with URLSession. All methods throw on network or decode errors.
@Observable
class APIClient {
    static let shared = APIClient()

    var baseURL: String {
        get { UserDefaults.standard.string(forKey: "apiBaseURL") ?? "https://japanese-tutor-558618474484.europe-west1.run.app/api" }
        set { UserDefaults.standard.set(newValue, forKey: "apiBaseURL") }
    }

    /// Device ID sent as X-User-ID on every request.
    /// Persisted in Keychain so it survives app reinstalls (unlike UserDefaults).
    /// On first launch: uses IDFV if available, otherwise generates a UUID.
    /// Once stored in Keychain, the same ID is returned forever — even after reinstall.
    var userId: String {
        #if DEBUG
        // Simulator testing only: launch with `-debugUserId <id>` to open an existing account
        if let debugId = UserDefaults.standard.string(forKey: "debugUserId"), !debugId.isEmpty {
            return debugId
        }
        #endif
        // 1. Check Keychain first (survives reinstalls)
        if let saved = KeychainHelper.read(key: "deviceUserId") {
            return saved
        }

        // 2. First launch — migrate from UserDefaults if an old ID exists
        if let legacy = UserDefaults.standard.string(forKey: "userId") {
            KeychainHelper.save(key: "deviceUserId", value: legacy)
            return legacy
        }

        // 3. Brand new install — use IDFV or generate a fresh UUID
        let newId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        KeychainHelper.save(key: "deviceUserId", value: newId)
        return newId
    }

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    private let encoder = JSONEncoder()

    /// Create a URLRequest with the X-User-ID header and Content-Type set.
    private func makeRequest(_ path: String, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: URL(string: "\(baseURL)\(path)")!)
        request.httpMethod = method
        request.setValue(userId, forHTTPHeaderField: "X-User-ID")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    // MARK: - Articles

    func fetchArticles(page: Int = 1, limit: Int = 20) async throws -> ArticleListResponse {
        return try await get("/articles?page=\(page)&limit=\(limit)")
    }

    func fetchArticle(id: Int) async throws -> Article {
        return try await get("/articles/\(id)")
    }

    /// Generates a new article. Throws `APIError.trialExhausted` if the device has used
    /// all 3 free slots and is not Pro — the caller should present the paywall.
    func generateArticle(proficiencyLevel: String? = nil, newWordsCount: Int? = nil, targetWordCount: Int? = nil, writingSystem: String? = nil, topic: String? = nil) async throws -> Article {
        var body: [String: Any] = [:]
        if let level = proficiencyLevel { body["proficiency_level"] = level }
        if let count = newWordsCount { body["new_words_per_article"] = count }
        if let wordCount = targetWordCount { body["target_word_count"] = wordCount }
        if let ws = writingSystem { body["writing_system"] = ws }
        if let t = topic, !t.isEmpty { body["custom_topic"] = t }

        var request = makeRequest("/articles/generate", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 600

        let (data, response) = try await URLSession.shared.data(for: request)

        // Check for 403 TRIAL_EXHAUSTED before the generic status check
        if let http = response as? HTTPURLResponse, http.statusCode == 403 {
            if let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               (body["error"] as? String) == "TRIAL_EXHAUSTED" {
                throw APIError.trialExhausted
            }
        }

        try validateResponse(response)
        return try decoder.decode(Article.self, from: data)
    }

    func markArticleRead(id: Int) async throws {
        let _: [String: Bool] = try await patch("/articles/\(id)", body: ["read_at": true])
    }

    func deleteArticle(id: Int, deleteVocabulary: Bool) async throws {
        let query = deleteVocabulary ? "?delete_vocabulary=true" : ""
        let _: DeleteResponse = try await delete("/articles/\(id)\(query)")
    }

    // MARK: - Vocabulary

    /// Fetches a paginated vocabulary list.
    /// - Parameters:
    ///   - limit: Number of words per page (default 50). Pass explicitly for paginated requests.
    ///   - offset: Number of words to skip (default 0). Increment by `limit` for each next page.
    /// The response `total` field always reflects the full unfiltered count so the UI can
    /// determine whether more pages exist without an extra request.
    func fetchVocabulary(status: String? = nil, level: String? = nil, search: String? = nil, limit: Int = 50, offset: Int = 0) async throws -> VocabularyListResponse {
        var params: [String] = []
        if let status = status { params.append("status=\(status)") }
        if let level = level { params.append("jlpt_level=\(level)") }
        if let search = search { params.append("search=\(search.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? search)") }
        params.append("limit=\(limit)")
        params.append("offset=\(offset)")
        let query = "?\(params.joined(separator: "&"))"
        return try await get("/vocabulary\(query)")
    }

    func fetchDueVocabulary() async throws -> VocabularyDueResponse {
        return try await get("/vocabulary/due")
    }

    func updateVocabularyStatus(id: Int, status: String) async throws -> VocabularyWord {
        return try await patch("/vocabulary/\(id)", body: ["status": status])
    }

    func recordTestResult(id: Int, correct: Bool) async throws -> TestResultResponse {
        return try await post("/vocabulary/\(id)/test", body: ["correct": correct])
    }

    /// Words for the daily typed review (due / missed / still learning first)
    func fetchReviewWords(limit: Int = 10) async throws -> ReviewWordsResponse {
        return try await get("/vocabulary/review?limit=\(limit)")
    }

    /// Add a word tapped in an article to the learner's vocabulary
    func addVocabulary(_ entry: WordLookup, articleId: Int?, contextSentence: String?) async throws -> VocabularyWord {
        let body = AddVocabularyRequest(
            wordRomajiMacron: entry.wordRomajiMacron,
            wordKanji: entry.wordKanji,
            wordKana: entry.wordKana,
            meaningEn: entry.meaningEn,
            partOfSpeech: entry.partOfSpeech,
            articleId: articleId,
            contextSentence: contextSentence
        )
        return try await post("/vocabulary", body: body)
    }

    // MARK: - Practice

    /// Meaning of any word tapped in an article (dictionary form + meaning in this sentence)
    func lookupWord(_ word: String, sentence: String) async throws -> WordLookup {
        return try await post("/practice/lookup", body: ["word": word, "sentence": sentence])
    }

    /// Claude checks a sentence the learner wrote with the given words
    /// `focus`: the learner's top weak spot, so the check watches for it.
    /// `firstTry`: only first tries are saved as mistakes (no double counting on "Check again").
    func checkSentence(words: [VocabularyWord], sentence: String, context: String?, focus: String? = nil, firstTry: Bool = true) async throws -> SentenceCheckResponse {
        let body = SentenceCheckRequest(
            words: words.map { .init(word: $0.wordRomajiMacron, meaning: $0.meaningEn) },
            sentence: sentence,
            context: context,
            focus: focus,
            firstTry: firstTry
        )
        return try await post("/practice/sentence", body: body)
    }

    /// Sentences of an article for the read-aloud player (cloud voice)
    func fetchSpeech(articleId: Int) async throws -> SpeechResponse {
        return try await get("/articles/\(articleId)/speech")
    }

    /// MP3 of one sentence, read by the cloud voice
    func fetchSentenceAudio(articleId: Int, index: Int, voice: String) async throws -> Data {
        var request = makeRequest("/articles/\(articleId)/speech/\(index)?voice=\(voice)")
        request.timeoutInterval = 20
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response)
        return data
    }

    /// Saved sentence-building corrections + weak spots (most frequent first)
    func fetchMistakes() async throws -> MistakesResponse {
        return try await get("/practice/mistakes")
    }

    // MARK: - Quiz

    func fetchQuiz(articleId: Int) async throws -> QuizResponse {
        return try await get("/articles/\(articleId)/quiz")
    }

    func submitQuiz(articleId: Int, answers: [QuizAnswer]) async throws -> QuizSubmitResponse {
        return try await post("/articles/\(articleId)/quiz", body: QuizSubmitRequest(answers: answers))
    }

    // MARK: - Config

    func fetchConfig() async throws -> AppConfig {
        return try await get("/config")
    }

    func updateConfig(_ updates: [String: Any]) async throws {
        var request = makeRequest("/config", method: "PUT")
        request.httpBody = try JSONSerialization.data(withJSONObject: updates)
        let (_, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response)
    }

    // MARK: - Stats

    func fetchStats() async throws -> StatsResponse {
        return try await get("/stats")
    }

    // MARK: - Device / Paywall

    /// Fetches trial status from the backend (generation_count, is_pro, trials_remaining).
    /// Call on app launch to initialise the paywall state.
    func fetchDeviceStatus() async throws -> DeviceStatus {
        return try await get("/device/status")
    }

    /// Call immediately after a successful RevenueCat purchase to unlock Pro on the backend.
    func upgradeDeviceToPro() async throws -> DeviceStatus {
        return try await post("/device/upgrade", body: EmptyBody())
    }

    // MARK: - Private Helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let request = makeRequest(path)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = makeRequest(path, method: "POST")
        request.httpBody = try encoder.encode(body)
        request.timeoutInterval = 600
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func patch<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = makeRequest(path, method: "PATCH")
        request.httpBody = try encoder.encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func delete<T: Decodable>(_ path: String) async throws -> T {
        let request = makeRequest(path, method: "DELETE")
        let (data, response) = try await URLSession.shared.data(for: request)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode)
        }
    }
}

// MARK: - Supporting types

/// Returned by GET /api/device/status and POST /api/device/upgrade
struct DeviceStatus: Codable {
    let deviceId:        String
    let generationCount: Int
    let isPro:           Bool
    let trialsRemaining: Int?   // nil when isPro is true

    enum CodingKeys: String, CodingKey {
        case deviceId        = "device_id"
        case generationCount = "generation_count"
        case isPro           = "is_pro"
        case trialsRemaining = "trials_remaining"
    }
}

/// Empty body for POST requests that carry no payload
private struct EmptyBody: Encodable {}

/// GET /api/vocabulary/review
struct ReviewWordsResponse: Codable {
    let words: [VocabularyWord]
    let count: Int
    /// Word ID → the learner's other words with the same meaning (also right answers)
    let alsoAccept: [String: [String]]?

    enum CodingKeys: String, CodingKey {
        case words, count
        case alsoAccept = "also_accept"
    }
}

/// POST /api/practice/lookup
struct WordLookup: Codable {
    let wordRomajiMacron: String
    let wordKanji: String?
    let wordKana: String?
    let meaningEn: String
    let partOfSpeech: String?
    let note: String
    let jlptLevel: String?
    /// Set when the learner already has this word
    let vocabularyId: Int?

    enum CodingKeys: String, CodingKey {
        case note
        case wordRomajiMacron = "word_romaji_macron"
        case wordKanji = "word_kanji"
        case wordKana = "word_kana"
        case meaningEn = "meaning_en"
        case partOfSpeech = "part_of_speech"
        case jlptLevel = "jlpt_level"
        case vocabularyId = "vocabulary_id"
    }
}

/// POST /api/vocabulary
struct AddVocabularyRequest: Encodable {
    let wordRomajiMacron: String
    let wordKanji: String?
    let wordKana: String?
    let meaningEn: String
    let partOfSpeech: String?
    let articleId: Int?
    let contextSentence: String?

    enum CodingKeys: String, CodingKey {
        case wordRomajiMacron = "word_romaji_macron"
        case wordKanji = "word_kanji"
        case wordKana = "word_kana"
        case meaningEn = "meaning_en"
        case partOfSpeech = "part_of_speech"
        case articleId = "article_id"
        case contextSentence = "context_sentence"
    }
}

/// POST /api/practice/sentence
struct SentenceCheckRequest: Encodable {
    struct Word: Encodable {
        let word: String
        let meaning: String
    }
    let words: [Word]
    let sentence: String
    let context: String?
    let focus: String?
    let firstTry: Bool

    enum CodingKeys: String, CodingKey {
        case words, sentence, context, focus
        case firstTry = "first_try"
    }
}

struct SentenceCheckResponse: Codable {
    struct Fix: Codable, Hashable {
        let wrote: String
        let correct: String
        let why: String
        let type: String?       // particle | verb_form | word_order | word_choice | adjective | other
        let pattern: String?    // "wo → ga with agaru"
    }
    struct WordUse: Codable {
        let word: String
        let usedCorrectly: Bool

        enum CodingKeys: String, CodingKey {
            case word
            case usedCorrectly = "used_correctly"
        }
    }
    let verdict: String      // "correct" | "almost" | "wrong"
    let corrected: String
    let english: String
    let fixes: [Fix]
    let words: [WordUse]
    let tip: String
}

/// GET /api/articles/:id/speech
struct SpeechResponse: Codable {
    let sentences: [String]
}

/// GET /api/practice/mistakes
struct MistakesResponse: Codable {
    let weakSpots: [WeakSpot]
    let mistakes: [SavedMistake]
    let count: Int

    enum CodingKeys: String, CodingKey {
        case weakSpots = "weak_spots"
        case mistakes, count
    }
}

struct WeakSpot: Codable, Identifiable, Hashable {
    struct Example: Codable, Hashable {
        let wrote: String
        let correct: String
        let why: String
    }
    let type: String
    let typeLabel: String
    let pattern: String
    let count: Int
    let example: Example

    var id: String { "\(type)|\(pattern)" }

    /// Sent to the sentence check so it watches for this slip
    var focusText: String { "\(pattern) (e.g. \(example.wrote) → \(example.correct))" }

    enum CodingKeys: String, CodingKey {
        case type, pattern, count, example
        case typeLabel = "type_label"
    }
}

struct SavedMistake: Codable, Identifiable, Hashable {
    let createdAt: String
    let type: String
    let pattern: String
    let wrote: String
    let correct: String
    let why: String
    let sentence: String
    let corrected: String

    var id: String { "\(createdAt)|\(wrote)|\(correct)" }

    enum CodingKeys: String, CodingKey {
        case type, pattern, wrote, correct, why, sentence, corrected
        case createdAt = "created_at"
    }
}

// MARK: - Errors

enum APIError: LocalizedError {
    case invalidResponse
    case httpError(Int)
    case requestFailed
    case trialExhausted     // 403 TRIAL_EXHAUSTED — present the paywall

    var errorDescription: String? {
        switch self {
        case .invalidResponse:  return "Invalid server response"
        case .httpError(let c): return "Server error (HTTP \(c))"
        case .requestFailed:    return "Request failed"
        case .trialExhausted:   return "Free trial limit reached"
        }
    }
}
