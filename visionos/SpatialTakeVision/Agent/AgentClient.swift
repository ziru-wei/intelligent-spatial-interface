import Foundation
import simd

/// The Spatial Take agent on the Mac (editor/scripts/server.py --lan, with its agent bridge answering the space's live session): asks
/// a question with the head's pose (space coordinates) and follows its answer as it streams in.
/// Where it is and the token it asks for come with the app (SpaceData/<space>/agent.json, written on the Mac by
/// `visionos/tools/mac.sh prepare`); nothing is entered on the headset.
struct AgentConfig: Decodable, Equatable {
    let server: String
    let token: String
    let session: String
    static func bundled(space: String, bundle: Bundle = .main) -> AgentConfig? {
        guard let url = bundle.url(forResource: "agent", withExtension: "json", subdirectory: "SpaceData/\(space)") else { return nil }
        return try? JSONDecoder().decode(AgentConfig.self, from: Data(contentsOf: url))
    }
}

struct AgentQuestion: Decodable { let id: Int; let text: String; let status: String; let created: Double?; let latency: Double? }
struct AgentResponse: Decodable {
    /// A streamed text's snapshots: `at` seconds after the agent started on the question.
    struct Update: Decodable { let at: Double; let status: String; let title: String; let body: String }
    struct Stream: Decodable { let status: String; let updates: [Update]? }
    let id: Int; let question_id: Int?; let part: String?
    let title: String; let body: String
    let latency: Double?            // seconds from the agent starting to this part
    let stream: Stream?
    let weather: WeatherData?
    let findmy: FindMyData?
    /// An info answer: the info key it is about and the thing selected for it (scripts/agent_store.py response_info).
    struct Info: Decodable, Equatable { let key: String; let box_id: String? }
    let info: Info?
    /// A zone's animation to play (part 'animation': the lab's diorama; scripts/jev-pipeline.mjs ZONE_ANIMATIONS).
    struct Animation: Decodable, Equatable { let id: String; let zone: String? }
    let animation: Animation?
}
/// A question asked on the headset before, with what the agent answered (Questions tab: replayed in the room now).
struct PastQuestion: Identifiable {
    let conversation: String, conversationName: String
    let question: AgentQuestion
    let responses: [AgentResponse]
    var id: String { "\(conversation)/\(question.id)" }
    var hasWeather: Bool { responses.contains { $0.weather != nil } }
    var answerText: String? { responses.last { !$0.title.isEmpty || !$0.body.isEmpty }.map { [$0.title, $0.body].filter { !$0.isEmpty }.joined(separator: " — ") } }
}
private struct ConversationListing: Decodable { let id: String; let name: String; let created: Double; let questions: Int }
private struct Status: Decodable { let connected: Bool; let questions: [AgentQuestion]; let responses: [AgentResponse] }
private struct Created: Decodable { let id: String }

struct AgentError: LocalizedError { let message: String; var errorDescription: String? { message } }

final class AgentClient {
    let config: AgentConfig
    private(set) var conversation: String?
    init(config: AgentConfig) { self.config = config }

    func request(_ path: String, query: [String: String] = [:], body: [String: Any]? = nil) async throws -> Data {
        guard var url = URLComponents(string: config.server + path) else { throw AgentError(message: "Bad server address.") }
        url.queryItems = query.isEmpty ? nil : query.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let u = url.url else { throw AgentError(message: "Bad server address.") }
        var r = URLRequest(url: u, timeoutInterval: 10)
        r.setValue(config.token, forHTTPHeaderField: "X-Spatial-Token")
        if let body {
            r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: r)
        guard let http = response as? HTTPURLResponse else { throw AgentError(message: "No response.") }
        guard http.statusCode == 200 else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw AgentError(message: http.statusCode == 403 ? "The server refused the app: run `visionos/tools/mac.sh prepare` on the Mac, rebuild, and start it with `mac.sh run`." : msg ?? "HTTP \(http.statusCode)")
        }
        return data
    }

    /// Whether the bridge is answering this session, and a fresh conversation for this run.
    func connect() async throws -> Bool {
        let created = try JSONDecoder().decode(Created.self, from: try await request("/api/agent/conversations", body: ["session": config.session, "name": "Vision Pro"]))
        conversation = created.id
        return try await status().connected
    }

    private func status() async throws -> Status {
        try JSONDecoder().decode(Status.self, from: try await request("/api/agent/status", query: ["session": config.session, "conversation": conversation ?? ""]))
    }

    /// Asks; the pose is the head's, in space coordinates. Returns the question's id.
    /// mods: which mods are on (weather, findmy); selection: what the user means (InfoSelectionResult.payload) and how it is judged
    /// ("jev": Jev also checks the question is about it; "score": the score alone).
    /// location: the zone the user is in and one they face (editor/scripts/location.py), for "here" and "this lab".
    func ask(_ text: String, spaceFromHead m: simd_float4x4, weatherMod: Bool, findmyMod: Bool, selection: [String: Any]?, selectionMode: String, location: [String: Any]?) async throws -> Int {
        if conversation == nil { _ = try await connect() }
        let q = simd_quatf(m)
        let body: [String: Any] = [
            "session": config.session, "conversation": conversation ?? "", "frame": 0, "t": 0, "text": text, "live": ["read_s": 5],
            "weather_mod": weatherMod, "findmy_mod": findmyMod, "ego_mod": false, "text_response": ["default": true, "weather": true, "findmy": true],
            "selection": selection ?? NSNull(), "selection_mode": selectionMode, "location": location ?? NSNull(),
            "pose": ["position": [m.translation.x, m.translation.y, m.translation.z].map(Double.init), "quaternion": [q.imag.x, q.imag.y, q.imag.z, q.real].map(Double.init)],
        ]
        let data = try await request("/api/agent/questions", body: body)
        guard let id = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["id"] as? Int else { throw AgentError(message: "The server did not take the question.") }
        return id
    }

    /// Every question asked in this session (all its conversations), newest first, with their answers.
    func history() async throws -> [PastQuestion] {
        let list = try JSONDecoder().decode([ConversationListing].self, from: try await request("/api/agent/conversations", query: ["session": config.session]))
        var out: [PastQuestion] = []
        for c in list where c.questions > 0 {
            let s = try JSONDecoder().decode(Status.self, from: try await request("/api/agent/status", query: ["session": config.session, "conversation": c.id]))
            for q in s.questions where q.status == "answered" {
                out.append(PastQuestion(conversation: c.id, conversationName: c.name, question: q, responses: s.responses.filter { $0.question_id == q.id }))
            }
        }
        return out.sorted { ($0.question.created ?? 0) > ($1.question.created ?? 0) }
    }

    /// The question's text answer as it stands (title, body, whether it is complete), its weather (the weather mod's UI part), and the
    /// question's status.
    func answer(to id: Int) async throws -> (question: AgentQuestion?, text: AgentResponse?, weather: WeatherData?, findmy: FindMyData?, animation: AgentResponse.Animation?, connected: Bool) {
        let s = try await status()
        let text = s.responses.last { $0.question_id == id && ($0.part == "text" || $0.part == nil) && (!$0.title.isEmpty || !$0.body.isEmpty) }
        let weather = s.responses.last { $0.question_id == id && $0.weather != nil }?.weather
        let findmy = s.responses.last { $0.question_id == id && $0.findmy != nil }?.findmy
        let animation = s.responses.last { $0.question_id == id && $0.animation != nil }?.animation
        return (s.questions.first { $0.id == id }, text, weather, findmy, animation, s.connected)
    }
}
