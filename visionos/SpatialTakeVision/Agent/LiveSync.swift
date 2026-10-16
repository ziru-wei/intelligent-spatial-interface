import Foundation

/// Keeps the app in step with the Mac (editor/scripts/vision.py), so nothing needs a rebuild:
///   the space   every 3 s, its layout revision; when the layout was saved in the web editor, the new layout and surfaces replace the
///               bundled ones (SpaceData, built in the app from the Mac's export), and when the scan's colours have been baked again,
///               their grids are downloaded into the app's caches
///   settings    every 2 s, the window's labeled controls as set on the Mac (editor/vision.html); a change made on the headset is sent
///               back, so both show the same
@MainActor
final class LiveSync {
    private let client: AgentClient
    private let space: String
    private var spaceRevision: String?
    private var colorsRevision: String?
    private var colorsData: Data?
    private var colorDir: URL?
    private var lastSettings: [String: Any] = [:]

    init(client: AgentClient, space: String) { self.client = client; self.space = space }

    /// Runs until cancelled. `apply(space)` gets each new space; `settings(values)` each change of the settings.
    func run(apply: @escaping (SpaceData) -> Void, settings: @escaping ([String: Any]) -> Void) async {
        var tick = 0
        while !Task.isCancelled {
            if tick % 3 == 0, let s = try? await fetchSpace() { apply(s) }
            if tick % 2 == 0, let v = try? await fetchSettings() { settings(v) }
            tick += 1
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private func json(_ data: Data) throws -> [String: Any] {
        guard let d = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw AgentError(message: "Bad reply.") }
        return d
    }

    private func fetchSpace() async throws -> SpaceData? {
        var query = ["space": space]
        if let spaceRevision { query["revision"] = spaceRevision }
        let d = try json(try await client.request("/api/vision/space", query: query))
        let revision = d["revision"] as? String, colors = d["colors"] as? String
        let layoutChanged = d["unchanged"] as? Bool != true
        // The colours: once baked again (a revision), downloaded into a fresh folder; while baking (none), the last ones stay.
        var colorsChanged = false
        if let colors, colors != colorsRevision, let fresh = try? await { Diag.mark("colours: downloading"); defer { Diag.mark("colours downloaded") }; return try await downloadColors(revision: colors) }() {
            colorsRevision = colors; colorsData = fresh.index; colorDir = fresh.dir; colorsChanged = true
        }
        guard layoutChanged || colorsChanged else { return nil }
        if layoutChanged {
            guard let semantic = d["semantic"], let surfaces = d["surfaces"] else { return nil }
            cachedSemantic = try JSONSerialization.data(withJSONObject: semantic)
            cachedSurfaces = try JSONSerialization.data(withJSONObject: ["space": space, "scan": d["scan"] ?? NSNull(), "surfaces": surfaces])
            spaceRevision = revision
        }
        guard let cachedSemantic, let cachedSurfaces else { return nil }
        let bundled = Bundle.main.url(forResource: space, withExtension: nil, subdirectory: "SpaceData")
        let colorsIndex = colorsData ?? bundled.flatMap { try? Data(contentsOf: $0.appending(path: "colors.json")) }
        let dir = colorDir ?? bundled?.appending(path: "colors") ?? FileManager.default.temporaryDirectory
        return try SpaceData(name: space, semantic: cachedSemantic, surfaces: cachedSurfaces, colors: colorsIndex, colorDir: dir)
    }
    private var cachedSemantic: Data?, cachedSurfaces: Data?

    private func downloadColors(revision: String) async throws -> (index: Data, dir: URL) {
        let indexData = try await client.request("/api/vision/colors", query: ["space": space])
        let d = try json(indexData)
        guard d["revision"] as? String == revision, let files = d["files"] as? [String: [String: Any]] else { throw AgentError(message: "Colours changed meanwhile.") }
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appending(path: "SpaceData/\(space)/colors-\(revision)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for entry in files.values {
            guard let file = entry["file"] as? String else { continue }
            let target = dir.appending(path: file)
            if FileManager.default.fileExists(atPath: target.path) { continue }
            try await client.request("/api/vision/color", query: ["space": space, "file": file]).write(to: target)
        }
        // Earlier downloads are no longer needed.
        let parent = dir.deletingLastPathComponent()
        for old in (try? FileManager.default.contentsOfDirectory(at: parent, includingPropertiesForKeys: nil)) ?? [] where old.lastPathComponent != dir.lastPathComponent {
            try? FileManager.default.removeItem(at: old)
        }
        return (try JSONSerialization.data(withJSONObject: ["files": files]), dir)
    }

    private func fetchSettings() async throws -> [String: Any]? {
        var d = try json(try await client.request("/api/vision/settings", query: ["space": space, "headset": "1"]))
        d["headsetSeen"] = nil
        guard !NSDictionary(dictionary: d).isEqual(to: lastSettings) else { return nil }
        lastSettings = d
        return d
    }

    /// Sends settings changed on the headset to the Mac.
    func send(_ fields: [String: Any]) async {
        guard let data = try? await client.request("/api/vision/settings", body: ["space": space, "settings": fields]), var d = try? json(data) else { return }
        d["headsetSeen"] = nil; lastSettings = d
    }
}
