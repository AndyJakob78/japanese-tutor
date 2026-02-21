import Foundation

/// API client for communicating with the Japanese Tutor backend.
/// Uses async/await with URLSession. All methods throw on network or decode errors.
@Observable
class APIClient {
    static let shared = APIClient()

    var baseURL: String {
        get { UserDefaults.standard.string(forKey: "apiBaseURL") ?? "https://japanese-tutor-558618474484.europe-west1.run.app/api" }
        set { UserDefaults.standard.set(newValue, forKey: "apiBaseURL") }
    }

    /// Unique device ID generated on first launch, sent with every request for per-user data isolation.
    var userId: String {
        if let existing = UserDefaults.standard.string(forKey: "userId") {
            return existing
        }
        let newId = UUID().uuidString
        UserDefaults.standard.set(newId, forKey: "userId")
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

    func generateArticle(proficiencyLevel: String? = nil, topic: String? = nil, newWordsCount: Int? = nil, targetWordCount: Int? = nil, writingSystem: String? = nil) async throws -> Article {
        var body: [String: Any] = [:]
        if let level = proficiencyLevel { body["proficiency_level"] = level }
        if let topic = topic { body["topic"] = topic }
        if let count = newWordsCount { body["new_words_per_article"] = count }
        if let wordCount = targetWordCount { body["target_word_count"] = wordCount }
        if let ws = writingSystem { body["writing_system"] = ws }

        var request = makeRequest("/articles/generate", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 600
        let (data, response) = try await URLSession.shared.data(for: request)
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

    func fetchVocabulary(status: String? = nil, level: String? = nil, search: String? = nil) async throws -> VocabularyListResponse {
        var params: [String] = []
        if let status = status { params.append("status=\(status)") }
        if let level = level { params.append("jlpt_level=\(level)") }
        if let search = search { params.append("search=\(search.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? search)") }
        let query = params.isEmpty ? "" : "?\(params.joined(separator: "&"))"
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
        request.timeoutInterval = 600 // 10 minutes for generation (rate limits may cause retries)
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

enum APIError: LocalizedError {
    case invalidResponse
    case httpError(Int)
    case requestFailed

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid server response"
        case .httpError(let code): return "Server error (HTTP \(code))"
        case .requestFailed: return "Request failed"
        }
    }
}
