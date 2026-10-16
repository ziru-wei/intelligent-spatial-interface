import SwiftUI
import RealityKit
import simd

/// The app's state: the space (atlas, from SpaceData), the room as the headset sees it, the alignment between the two, and the agent.
///
/// Entities: `root` (world) holds the room's mesh (collision only, for visibility) and `spaceRoot`, placed at worldFromSpace; the
/// layout overlay and the answers are children of `spaceRoot` in space coordinates, so fine-tuning the alignment moves them along.
@MainActor
@Observable
final class AppModel {
    static let roomSpaceID = "Room"
    static let panelID = "Panel"
    /// The settings window (it can be closed and opened again from the question bar).
    var panelOpen = false
    /// The room was opened by the app itself (at launch): it is not reopened by the app after that, but when it closed by itself.
    static var roomOpenedOnce = false
    @ObservationIgnored var roomOpenedAt = Date.distantPast
    /// The room closed within a few seconds of opening (visionOS took it back), and how often it was opened again for that.
    var roomClosedEarly = false
    @ObservationIgnored var roomReopens = 0
    /// The settings shown in the room, over the ask bar (opened from the bar), instead of in their window.
    var settingsInRoom = false
    /// The controls in the room (the ask bar, the settings) hidden: the left hand, palm down, going from open to a fist. The weather's
    /// controls stay.
    var barsHidden = false
    /// The list open under the ask bar: "presets" (ready-made questions) or "history" (past questions); nil: none.
    var barList: String?
    /// Speech to text (the bar's mic, and the right hand's fist held while speaking).
    @ObservationIgnored let speech = SpeechInput()
    /// A voice episode by hand: the right fist held (listening, what is heard floating over the back of the hand) until it opens.
    var voiceEpisode = false
    @ObservationIgnored private var voiceLostSince: Date?
    @ObservationIgnored private weak var voiceCaption: Entity?
    static let spaceName = "atlas"

    /// The space: bundled at build time, then kept in step with the Mac (LiveSync: layout saved in the web editor, colours re-baked).
    var space: SpaceData?
    let loadError: String?
    let sensing = WorldSensing()
    let root = Entity(), spaceRoot = Entity()
    private var overlay: Entity?
    private var answers: [AnswerEntity] = []
    private let store = AlignmentStore(space: AppModel.spaceName)

    /// The mixed immersive space is open (it opens with the app: answers and weather live there).
    var roomOpen = false
    var zone: String? = nil { didSet { refreshOverlay(); push("zone", zone as Any? ?? NSNull()) } }
    /// Room view: the room's metadata (the layout's walls, furniture and openings) drawn over it, for debugging and aligning. Answers
    /// and weather show whether it is on or not.
    var showLayout = UserDefaults.standard.bool(forKey: "roomView") { didSet { overlay?.isEnabled = showLayout; UserDefaults.standard.set(showLayout, forKey: "roomView"); push("roomView", showLayout) } }
    var worldFromSpace: simd_float4x4? { didSet { if let m = worldFromSpace { spaceRoot.transform = Transform(matrix: m); spaceRoot.isEnabled = true } } }
    var alignmentStatus = "Not aligned"
    var anchored = false

    let agentConfig: AgentConfig?
    private let agent: AgentClient?
    var connectionStatus = "Not connected"
    var askStatus = ""
    var lastAnswer = ""
    var bodySize: Float = 1 { didSet { push("bodySize", Double(bodySize)) } }

    /// The rest of the window's labeled settings (Behavior, the mods), kept with the Mac like the others (scripts/vision.py DEFAULTS:
    /// the same names). Defaults as the web editor's.
    struct Behavior: Codable, Equatable {
        var headingSize: Double = 1, showHeading = true
        var writing = true, writingStrokes = true, writingSpeed: Double = 30
        var stability: Double = 0, occlusion = true
        var selectionMode = "jev", infoMinShrink: Double = 0.55, floatParallel: Double = 80, arrowWidth: Double = 1
        var findmyMod = true, findmyRemoveOnApproach = false, findmyApproach: Double = 0.25
        var followMode = "lazy"   // the question bar and weather controls: "lazy" (glide back after a turn or a step) or "realtime"
    }
    var behavior = Behavior() {
        didSet {
            guard behavior != oldValue else { return }
            sensing.occlusion = behavior.occlusion
            let now = Self.fields(behavior), before = Self.fields(oldValue)
            for (k, v) in now where !NSDictionary(dictionary: [k: v]).isEqual(to: [k: before[k] ?? NSNull()]) { push(k, v) }
        }
    }
    private static func fields(_ b: Behavior) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(b)) as? [String: Any]) ?? [:]
    }

    // Weather mod: the answer's forecast plays on a window, the ceiling or a patch where the user looks (WeatherTarget), one entry
    // per seconds_per_period; with Lock location, it stays where it first showed until the next weather answer.
    var weatherMod = UserDefaults.standard.object(forKey: "weatherMod") as? Bool ?? true { didSet { UserDefaults.standard.set(weatherMod, forKey: "weatherMod"); push("weatherMod", weatherMod) } }
    var weatherLock = UserDefaults.standard.bool(forKey: "weatherLock") { didSet { UserDefaults.standard.set(weatherLock, forKey: "weatherLock"); push("weatherLock", weatherLock) } }
    private(set) var weather: WeatherData?
    var weatherIndex = 0 { didSet { weatherFraction = 0 } }
    var weatherPlaying = true
    private var weatherFraction = 0.0
    private var weatherTarget: WeatherTarget?
    private var weatherEffect: WeatherEffect?
    private var weatherTask: Task<Void, Never>?
    var weatherLabel: String { weather.map { w in w.entries.isEmpty ? "" : w.entries[min(weatherIndex, w.entries.count-1)].label } ?? "" }
    var weatherPlace: String { weatherTarget.map { $0.whole ? ($0.kind == "window" ? "the window" : "the ceiling") : ($0.surface.label ?? ($0.horizontal ? "the surface below" : "the wall")) } ?? "" }

    init() {
        Diag.watchMain(); Diag.mark("app model: loading the space")
        defer { speech.onFinish = { [weak self] text in Task { await self?.ask(text); await self?.loadQuestions() } } }
        do { space = try SpaceData(named: AppModel.spaceName); loadError = nil } catch { space = nil; loadError = error.localizedDescription }
        agentConfig = AgentConfig.bundled(space: AppModel.spaceName); agent = agentConfig.map(AgentClient.init(config:))
        root.addChild(sensing.meshRoot); root.addChild(spaceRoot)
        spaceRoot.isEnabled = false
        refreshOverlay()
        if let m = store.lastTransform { worldFromSpace = m; alignmentStatus = "Last alignment (waiting for its saved anchor)" }
        if let agent {
            let sync = LiveSync(client: agent, space: AppModel.spaceName); self.sync = sync
            syncTask = Task { [weak self] in
                await sync.run(apply: { s in Diag.mark("live space from the Mac: applying"); self?.space = s; self?.refreshOverlay(); Diag.mark("live space applied") }, settings: { v in self?.applySettings(v) })
            }
        }
        sensing.onWorldAnchor = { [weak self] anchor in
            guard let self, anchor.id == self.store.anchorID else { return }
            self.worldFromSpace = anchor.originFromAnchorTransform; self.anchored = true; self.alignmentStatus = "Restored from the saved anchor"
        }
    }

    // MARK: Live sync (the Mac's web editor)

    @ObservationIgnored private var sync: LiveSync?
    @ObservationIgnored private var syncTask: Task<Void, Never>?
    @ObservationIgnored private var applyingRemote = false

    /// A setting changed on the headset: sent to the Mac (not while applying the Mac's own).
    private func push(_ key: String, _ value: Any) {
        guard !applyingRemote, let sync else { return }
        Task { await sync.send([key: value]) }
    }

    private func applySettings(_ v: [String: Any]) {
        Diag.mark("settings from the Mac")
        applyingRemote = true; defer { applyingRemote = false }
        takeTunedAlignment(v["alignment"] as? [String: Any])
        if let b = v["roomView"] as? Bool, b != showLayout { showLayout = b }
        if let b = v["weatherMod"] as? Bool, b != weatherMod { weatherMod = b }
        if let b = v["weatherLock"] as? Bool, b != weatherLock { weatherLock = b }
        if let n = v["bodySize"] as? Double, abs(Float(n) - bodySize) > 1e-4 { bodySize = Float(n) }
        if v.keys.contains("zone") { let z = v["zone"] as? String; if z != zone { zone = z } }
        var b = Self.fields(behavior)
        for k in b.keys { if let x = v[k] { b[k] = x } }
        if let data = try? JSONSerialization.data(withJSONObject: b), let next = try? JSONDecoder().decode(Behavior.self, from: data), next != behavior { behavior = next }
    }

    private func refreshOverlay() {
        Diag.mark("layout overlay: building"); defer { Diag.mark("layout overlay built") }
        overlay?.removeFromParent()
        guard let space else { return }
        let o = LayoutOverlay.make(space.semantic, zone: zone)
        o.isEnabled = showLayout; spaceRoot.addChild(o); overlay = o
    }

    // MARK: Tuning the alignment in the editor (Vision Pro tab › Tune)

    /// The alignment, row-major (the editor's matrices), and back.
    static func rowMajor(_ m: simd_float4x4) -> [Double] { (0..<4).flatMap { r in (0..<4).map { c in Double(m[c][r]) } } }
    static func matrix(rowMajor v: [Double]) -> simd_float4x4? {
        guard v.count == 16 else { return nil }
        var m = matrix_identity_float4x4
        for r in 0..<4 { for c in 0..<4 { m[c][r] = Float(v[r*4 + c]) } }
        return m
    }
    @ObservationIgnored private var tunedSeq: Int?
    /// An alignment set in the editor: taken (and saved here and as the world anchor) once per new number. The number there when the
    /// app starts is an old one: it is only noted.
    private func takeTunedAlignment(_ a: [String: Any]?) {
        guard let a, let seq = a["seq"] as? Int, let v = a["worldFromSpace"] as? [Double], let m = Self.matrix(rowMajor: v) else { if tunedSeq == nil { tunedSeq = 0 }; return }
        defer { tunedSeq = seq }
        guard let seen = tunedSeq, seq > seen else { return }
        worldFromSpace = m; anchored = false
        alignmentStatus = "Tuned in the editor. Saving…"
        Task { await saveAlignment(); alignmentStatus = "Tuned in the editor · " + alignmentStatus }
    }
    /// Every 10 s while the room is open and aligned: the room's mesh as the headset sees it (one point per 6 cm, world) and the
    /// alignment, for the editor to tune it against the scan.
    private func sendRoom() async {
        guard let agent, let m = worldFromSpace, !sensing.meshAnchors.isEmpty else { return }
        let pts = await sensing.meshSamples(spacing: 0.06, cap: 25000, structure: false)
        let flat = pts.flatMap { [Double(($0.p.x*1000).rounded()/1000), Double(($0.p.y*1000).rounded()/1000), Double(($0.p.z*1000).rounded()/1000)] }
        Diag.mark("room sent: \(pts.count) points")
        _ = try? await agent.request("/api/vision/room", body: ["space": AppModel.spaceName, "worldFromSpace": Self.rowMajor(m), "points": flat])
    }
    @ObservationIgnored private var roomTask: Task<Void, Never>?

    func roomOpened() async {
        Diag.mark("room opened"); roomOpenedAt = Date(); roomClosedEarly = false
        defer { Diag.mark("room: sensing started") }
        if roomTask == nil { roomTask = Task { [weak self] in while !Task.isCancelled { try? await Task.sleep(for: .seconds(10)); if self?.roomOpen == true { await self?.sendRoom() } } } }
        roomOpen = true
        await sensing.start()
        sensing.occlusion = behavior.occlusion
        if connectionStatus == "Not connected" || connectionStatus.hasPrefix("Failed") { Task { await connect() } }   // the agent: right away
        if frameTask == nil { frameTask = Task { [weak self] in while !Task.isCancelled { Diag.time("frame tick") { self?.tick() }; try? await Task.sleep(for: .milliseconds(33)) } } }
    }

    // MARK: Each frame

    @ObservationIgnored private var frameTask: Task<Void, Never>?
    @ObservationIgnored private var lastSlowTick = Date.distantPast
    @ObservationIgnored private var lastSelectionTick = Date.distantPast
    @ObservationIgnored private var lastTick = Date()
    @ObservationIgnored private let started = Date()
    @ObservationIgnored private var selection: InfoSelectionResult?
    /// How the user stands to the room now (SpatialRelations: A a desk, B a wall faced, D what the gaze is on), with hysteresis.
    @ObservationIgnored private(set) var relation: SpatialRelation?
    @ObservationIgnored private let relations = RelationTracker()
    @ObservationIgnored private lazy var glow: SelectionGlow = { let g = SelectionGlow(); spaceRoot.addChild(g); return g }()

    /// ~30 Hz: info arrows turned to the viewer, FindMy's guidance, the selection's glow; five times a second: what the user means;
    /// twice a second: answers kept readable, Room view's selection.
    private func tick() {
        guard let head = sensing.head() else { return }
        Diag.time("follow panels") { followPanels(head: head) }
        Diag.time("gestures") { detectGestures() }
        guard let m = worldFromSpace else { return }
        let pose = HeadPose(spaceFromHead: m.inverse*head), hands = handsInSpace()
        Diag.time("answer marks") { for a in answers { a.marks?.update(eye: pose.eye) } }
        if let z = zoneAnimation { Diag.time("animation touch") { z.update(hands: sensing.hands()) } }
        // Text lying on a table (the weather's, an ordinary answer's) turns smoothly to read toward the user.
        for a in answers where a.infoBox == nil { a.turnToward(eye: pose.eye) }
        findmy?.update(head: pose, hands: hands, removeOnApproach: behavior.findmyRemoveOnApproach, approach: Float(behavior.findmyApproach))
        let now = Date()
        if now.timeIntervalSince(lastSelectionTick) > 0.2 {
            lastSelectionTick = now
            Diag.time("selection") { selection = currentSelection(); glow.show(selection?.selected?.target) }
            if let space { Diag.time("relation") { relation = relations.update(space.surfaces, head: pose, blocked: blockedNow) } }
            Diag.time("location") { showLocation(location(head: pose)) }
        }
        Diag.time("glow") { glow.update(time: Float(now.timeIntervalSince(started)), dt: Float(min(0.1, now.timeIntervalSince(lastTick)))) }; lastTick = now
        if now.timeIntervalSince(lastSlowTick) > 0.5 {
            lastSlowTick = Date()
            Diag.time("keep readable") { keepReadable(head: pose) }
            Diag.time("keep the animation clear") { keepAnimationClear(head: pose) }
            Diag.time("room view selection") { showSelection(head: pose, hands: hands) }
        }
    }

    /// The hands (space coordinates).
    private func handsInSpace() -> [WorldSensing.Hand] {
        guard let m = worldFromSpace else { return [] }
        let inv = m.inverse
        return sensing.hands().map { .init(wrist: inv.point($0.wrist), indexKnuckle: inv.point($0.indexKnuckle), indexTip: inv.point($0.indexTip), joints: $0.joints.map(inv.point)) }
    }

    /// Whether something real (the room's mesh) is in the way along a ray (space), short of `distance`.
    private func blockedNow(_ origin: V3, _ dir: V3, _ distance: Float) -> Bool {
        guard distance > 0.02, let m = worldFromSpace else { return false }
        return sensing.cast(from: m.point(origin), direction: m.vector(dir).normalized, length: distance) != nil
    }

    /// For points (space): how far in front of each the room's mesh is along the ray from the eye now (TextPlacement.DepthProbe).
    private func probeNow(_ pts: [V3]) -> [Float?] {
        guard let m = worldFromSpace, let head = sensing.head() else { return pts.map { _ in nil } }
        return sensing.inFront(pts.map { m.point($0) }, from: head.translation)
    }

    /// Whether points (space) are in plain sight from the eye now.
    private func visibleNow(_ pts: [V3]) -> [Bool] {
        guard let m = worldFromSpace, let head = sensing.head() else { return pts.map { _ in true } }
        return sensing.visible(pts.map { m.point($0) }, from: head.translation)
    }

    // MARK: Info selection

    /// What the user means now (a thing carrying info), as the question will carry it.
    func currentSelection() -> InfoSelectionResult? {
        guard let space, let m = worldFromSpace, let head = sensing.head() else { return nil }
        let targets = InfoSelection.targets(space.semantic)
        guard !targets.isEmpty else { return nil }
        let pose = HeadPose(spaceFromHead: m.inverse*head)
        let here = location(head: pose)
        // In sight with some slack: a poster or a booklet lies flat on a surface, and the alignment is off by a few centimetres, so its
        // box is often just behind the room's mesh.
        let seen = { [self] (pts: [V3]) -> [Bool] in
            guard let m = worldFromSpace, let head = sensing.head() else { return pts.map { _ in true } }
            return sensing.visible(pts.map { m.point($0) }, from: head.translation, slack: 0.15)
        }
        return InfoSelection.select(targets, head: pose, hands: handsInSpace(), visible: seen, zones: [here.inZone, here.facing?.zone].compactMap { $0 })
    }
    var selectionSummary = ""
    @ObservationIgnored private var selectionMarks: Entity?

    /// Room view: each thing carrying info that scores, with its score over it (the chosen one brightest).
    private func showSelection(head: HeadPose, hands: [WorldSensing.Hand]) {
        selectionMarks?.removeFromParent(); selectionMarks = nil
        guard showLayout, let r = selection else { selectionSummary = ""; return }
        let pct = { (v: Float) in "\(Int((v*100).rounded()))%" }
        selectionSummary = (r.selected.map { "Selected: \($0.target.key) \(pct($0.share))" + ($0.zone ? " (zone)" : "") } ?? "Nothing selected") + " · nothing \(pct(r.nothing))"
            + "\nRelation: " + (relation?.label ?? "none")
        let root = Entity()
        for s in r.scores.prefix(6) where s.share >= 0.01 {
            let chosen = s.target.id == r.selected?.target.id
            let label = SelectionLabel.make("\(s.target.key)  \(pct(s.share))", tone: chosen ? 2 : s.share >= r.nothing ? 1 : 0)
            label.position = s.target.center + V3(0, s.target.size.y/2 + 0.12, 0)
            label.components.set(BillboardComponent())
            root.addChild(label)
        }
        spaceRoot.addChild(root); selectionMarks = root
    }


    // MARK: Alignment

    /// Lines the layout up from the planes found so far (walk around and look at the walls, floor and tables first).
    func autoAlign() {
        guard let space else { return }
        let planes = sensing.observations()
        guard let r = AutoAligner.align(planes, semantic: space.semantic, zone: zone) else {
            alignmentStatus = "Not enough seen yet: \(planes.filter(\.vertical).count) walls, \(planes.filter { $0.kind == .floor }.count) floors. Look around the room."
            return
        }
        worldFromSpace = r.worldFromSpace; anchored = false
        alignmentStatus = "Auto-aligned: " + r.summary + "."
        Task { await refineAlignment(candidates: [r.worldFromSpace] + r.others, coarse: r.summary) }
    }

    /// Fine alignment against the scan (ICPRefiner): from each candidate (the alignment now; after auto-align its runners-up too), the
    /// one that puts most of the room's mesh on the scan.
    var refining = false
    @ObservationIgnored private var scanCloud: (all: ScanCloud, shell: ScanCloud)?
    func refineAlignment(candidates: [simd_float4x4]? = nil, coarse: String? = nil) async {
        guard let now = worldFromSpace, !refining else { return }
        refining = true; defer { refining = false }
        alignmentStatus = (coarse.map { "Auto-aligned: \($0). " } ?? "") + "Refining against the scan…"
        if scanCloud == nil {
            let name = AppModel.spaceName, sem = space?.semantic
            scanCloud = await Task.detached(priority: .userInitiated) { () -> (ScanCloud, ScanCloud)? in
                guard let all = ScanCloud(space: name) else { return nil }
                return (all, sem.map(all.shell) ?? all)
            }.value
        }
        guard let clouds = scanCloud else { alignmentStatus = "No scan points in the app: run `visionos/tools/mac.sh prepare` and build again."; return }
        // The room's shell on both sides (clutter left out) when there is enough of it, else everything.
        let shellLive = await sensing.meshSamples(structure: true)
        let useShell = shellLive.count >= 1500 && clouds.shell.points.count >= 20000
        let live = useShell ? shellLive : await sensing.meshSamples(structure: false), scan = useShell ? clouds.shell : clouds.all
        guard live.count >= ICPRefiner.minInliers else { alignmentStatus = "Too little of the room's mesh yet (\(live.count) points). Look around, then refine."; return }
        let starts = candidates ?? [now]
        let results = await Task.detached(priority: .userInitiated) { starts.compactMap { ICPRefiner.refine($0, live: live, scan: scan) } }.value
        // The alignment may have been moved by hand meanwhile: then this result is stale.
        guard worldFromSpace == now else { alignmentStatus = "Refining was overtaken by a change; refine again."; return }
        guard let best = results.max(by: { $0.inliers < $1.inliers }) else {
            alignmentStatus = (coarse.map { "Auto-aligned: \($0). " } ?? "") + "The mesh did not match the scan near here; fine-tune by hand."
            return
        }
        worldFromSpace = best.worldFromSpace; anchored = false
        alignmentStatus = "Refined" + (useShell ? " on walls and floor" : " (everything: little of the shell classified)") + ": " + best.summary + (best.fraction < 0.4 ? ". Little matched: check it, nudge, then refine again." : ". Check it, then save.")
    }

    enum Nudge { case left, right, forward, back, up, down, turnLeft, turnRight }
    /// Moves the layout by `step` metres (or degrees when turning) in the user's own frame: left/right/forward/back as the user faces,
    /// turning about the user.
    func nudge(_ n: Nudge, step: Float) {
        guard let m = worldFromSpace else { return }
        let head = sensing.head() ?? matrix_identity_float4x4
        var f = -head.zAxis; f.y = 0; f = f.length > 1e-3 ? f.normalized : V3(0, 0, -1)
        let r = simd_cross(f, worldUp).normalized
        let delta: simd_float4x4
        switch n {
        case .left: delta = .init(translation: -r*step)
        case .right: delta = .init(translation: r*step)
        case .forward: delta = .init(translation: f*step)
        case .back: delta = .init(translation: -f*step)
        case .up: delta = .init(translation: worldUp*step)
        case .down: delta = .init(translation: -worldUp*step)
        case .turnLeft, .turnRight:
            let h = head.translation, a = radians(n == .turnLeft ? step : -step)
            delta = simd_float4x4(translation: h) * simd_float4x4(yaw: a, translation: .zero) * simd_float4x4(translation: -h)
        }
        worldFromSpace = delta * m; anchored = false
        alignmentStatus = "Adjusted. Save to keep it."
    }

    func saveAlignment() async {
        guard let m = worldFromSpace else { return }
        store.lastTransform = m
        do {
            store.anchorID = try await sensing.saveAnchor(m, replacing: store.anchorID)
            anchored = true; alignmentStatus = "Saved (world anchor)."
        } catch { alignmentStatus = "Saved here only (the anchor failed: \(error.localizedDescription))." }
    }

    // MARK: Agent

    func connect() async {
        guard let agent else { connectionStatus = "No connection in the app: run `visionos/tools/mac.sh prepare` on the Mac and build again."; return }
        connectionStatus = "Connecting…"
        do { connectionStatus = try await agent.connect() ? "Connected · bridge answering" : "Connected · the bridge is not running (`visionos/tools/mac.sh run` on the Mac)" }
        catch { connectionStatus = "Failed: \(error.localizedDescription)" }
    }

    /// Asks at the user's pose now; the answer is placed where the user is looking when its first words arrive and grows as it streams.
    func ask(_ text: String) async {
        guard worldFromSpace != nil else { askStatus = "Align the layout first."; return }
        guard let agent else { askStatus = "No connection in the app: run `visionos/tools/mac.sh prepare` on the Mac and build again."; return }
        guard let head = sensing.head(), let m = worldFromSpace else { askStatus = "The headset is not tracking."; return }
        stopReplay(); clearAnswers()
        askStatus = "Asking…"
        let selection = currentSelection()?.payload
        let here = location(head: HeadPose(spaceFromHead: m.inverse*head))
        Diag.mark("asking at: in \(here.inZone ?? "-"), facing \(here.facing.map { "\($0.zone) (\($0.via))" } ?? "-")")
        let id: Int
        do { id = try await agent.ask(text, spaceFromHead: m.inverse * head, weatherMod: weatherMod, findmyMod: behavior.findmyMod, selection: selection, selectionMode: behavior.selectionMode, location: here.payload) }
        catch { askStatus = "Failed: \(error.localizedDescription)"; return }
        askStatus = "Agent thinking…"
        var entity: AnswerEntity?, shown = ""
        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline {
            try? await Task.sleep(for: .milliseconds(250))
            guard let state = try? await agent.answer(to: id) else { continue }
            if let w = state.weather, w != weather { startWeather(w, host: entity) }
            if let f = state.findmy { await showFindMy(f) }
            if let a = state.animation { await showZoneAnimation(a) }
            if let r = state.text, r.title + "\n" + r.body != shown || entity?.streamingDone == false && r.stream?.status != "streaming" {
                shown = r.title + "\n" + r.body
                entity = await present(title: r.title, body: r.body, info: r.info, streaming: r.stream?.status == "streaming", into: entity)
                keepAnimationClearNow()   // text appearing (or growing) over the animation moves off it at once
            }
            // Done once the question is answered and its text is complete (the weather's UI part may come before or after the text).
            if let q = state.question, q.status == "answered", let r = state.text, r.stream?.status != "streaming" { return }
            if let q = state.question, q.status == "failed" { askStatus = "The agent failed on this question."; return }
            if let q = state.question, q.status == "answered", state.text == nil { askStatus = state.weather != nil ? "Weather (no text)." : "Answered without text."; return }
            if !state.connected && entity == nil { askStatus = "No bridge is answering this session." }
        }
        if entity == nil { askStatus = "No answer within 90 s." }
    }

    /// Shows answer text: the first time placed where the user looks now (a new entity), then updated in place as it streams. An info
    /// answer (info: its key and the thing selected) goes by its box (InfoPlacement) with its marks; a zone's answer is placed as any
    /// other. Returns the entity it is on (nil when it could not be placed).
    private func present(title: String, body: String, info: AgentResponse.Info?, streaming: Bool, into entity: AnswerEntity?) async -> AnswerEntity? {
        lastAnswer = [title, body].filter { !$0.isEmpty }.joined(separator: "\n")
        // Every answer is hand-lettered.
        let layout = TextLayout(title: title, body: body, settings: TextSettings(bodySize: bodySize, headingSize: Float(behavior.headingSize), showHeading: behavior.showHeading, info: true))
        // A FindMy answer's text hangs under the ask bar (FINDMY_TEXT), whether it came before the FindMy part or after.
        if findmyAnswering && info == nil {
            let hand = TextLayout(title: title, body: body, settings: TextSettings(bodySize: bodySize, headingSize: Float(behavior.headingSize), showHeading: behavior.showHeading, info: true))
            if let entity, entity !== findmyText {
                answers.removeAll { $0 === entity }
                if findmyText == nil {   // moved under the bar, its writing going on (not written in again)
                    if entity === barText { barText = nil }
                    findmyText = entity; await hang(entity, under: true)
                } else { entity.removeFromParent() }
            }
            return await showFindMyText(hand, title: title, body: body, streaming: streaming)
        }
        if let entity, entity === barText { return await showBarText(title: title, body: body, streaming: streaming) }
        if let entity { entity.text = (title, body); await entity.setText(layout, streaming: streaming); return entity }
        guard let space, let m = worldFromSpace, let head = sensing.head() else { return nil }
        let pose = HeadPose(spaceFromHead: m.inverse * head)
        let box = info.flatMap { infoBox(for: $0, eye: pose.eye) }
        var placed: PlacedText?, spot: InfoPlacement.Spot?
        if let box {
            if let r = InfoPlacement.place(box: box, surfaces: space.surfaces, head: pose, metrics: layout.metrics, minShrink: Float(behavior.infoMinShrink), parallel: Float(behavior.floatParallel), relation: relation, probe: probeNow) { placed = r.0; spot = r.1 }
        } else if weather != nil, let t = weatherTarget ?? { pickWeatherTarget(); return weatherTarget }() {
            placed = weatherTextPlace(t, metrics: layout.metrics, head: pose)
        } else {
            // An ordinary answer: beside the animation playing with it; else on the desk or table in front, on the wall faced, else
            // over the ask bar.
            placed = zoneAnimation != nil ? besideAnimation(layout.metrics, head: pose) ?? answerPlace(layout.metrics, head: pose) : answerPlace(layout.metrics, head: pose)
            if zoneAnimation != nil, placed != nil, besideAnimationText == nil { pendingBeside = true }
            if placed == nil { return await showBarText(title: title, body: body, streaming: streaming) }
        }
        guard let placed = placed ?? TextPlacement.floating(head: pose, metrics: layout.metrics) else { return nil }
        let e = AnswerEntity(); spaceRoot.addChild(e); answers.append(e); e.text = (title, body)
        if pendingBeside { besideAnimationText = e; pendingBeside = false }
        e.writing = .init(on: behavior.writing, strokes: behavior.writingStrokes, speed: behavior.writingSpeed)
        e.infoBox = box
        e.overlay = box == nil && weather != nil && weatherTarget != nil
        await e.show(layout, at: placed, streaming: streaming)
        if let box {
            let marks = InfoMarks(box: box, text: placed, eye: pose.eye, surfaces: space.surfaces, thickness: Float(behavior.arrowWidth))
            spaceRoot.addChild(marks); e.marks = marks
        }
        Diag.mark("answer placed: relation \(relation?.label ?? "none")" + (weather != nil ? ", weather on \(weatherTarget?.kind ?? "-") \(weatherTarget?.surface.label ?? "")" : "")
                  + ", text on \(placed.surface.label ?? placed.surface.id)" + (box.map { " (info: \($0.key))" } ?? "")
                  + (spot.map { String(format: " score %.2f near %.2f facing %.2f clean %.2f level %.2f rel %.1f%@", $0.score, $0.near, $0.facing, $0.clean, $0.level, $0.relation, placed.settled ? " settled" : "") } ?? ""))
        let where_ = placed.surface.kind == "none" ? (box != nil ? "beside \(box?.label ?? box?.key ?? "the box")" : "floating: no surface fits") : "on \(placed.surface.label ?? placed.surface.id)"
        askStatus = "Answer \(where_)" + (spot.map { String(format: " · info score %.2f%@", $0.score, placed.settled ? ", settled" : "") } ?? "")
        if weather != nil && weatherHost == nil { weatherHost = e }   // the weather came first: its controls go under this text
        return e
    }

    /// The box an info answer is about: the one selected (layout:<id>; an id without a prefix is a layout box), else the nearest one
    /// carrying its key; nil for a zone (placed as any answer) or when the space has none.
    private func infoBox(for info: AgentResponse.Info, eye: V3) -> InfoTarget? {
        guard let space else { return nil }
        let targets = InfoSelection.targets(space.semantic).filter { $0.size != .zero }
        if let id = info.box_id {
            if id.hasPrefix("zone:") { return nil }
            let full = id.contains(":") ? id : "layout:" + id
            if let t = targets.first(where: { $0.id == full }) { return t }
        }
        return targets.filter { $0.key == info.key }.min { simd_distance($0.center, eye) < simd_distance($1.center, eye) }
    }

    // MARK: Keeping answers readable

    @ObservationIgnored private var badSince: [ObjectIdentifier: Date] = [:]
    @ObservationIgnored private var settleTried: [ObjectIdentifier: Date] = [:]
    /// An answer stays where it is while it is readable from where the user is (in the view, not hidden, not too small); one that has
    /// not been, for a grace period (1.5 s, + 3 s × Placement stability), is placed again where the user looks, easing there. An info
    /// answer settled on a surface never moves.
    private func keepReadable(head: HeadPose) {
        guard let space else { return }
        for a in answers where a !== barText {   // the text over the bar goes with the bar
            guard let p = a.placed, let layout = a.layout, !p.settled else { continue }
            if a === besideAnimationText, zoneAnimation != nil {   // with its animation: kept beside it (placed again there when unreadable)
                let angles = TextPlacement.viewAngles(p.center, head: head)
                if angles.map({ abs($0.x) < TextPlacement.halfFieldH*1.5 && abs($0.y) < TextPlacement.halfFieldV*1.5 }) ?? false { continue }
                if let next = besideAnimation(layout.metrics, head: head) { Task { await a.move(to: next) } }
                continue
            }
            // An info answer stays where it was put (the web's: world-fixed, never following the viewer); every 2 s it looks for a spot to
            // settle on, and goes there (locked) once one turns up.
            if let box = a.infoBox {
                let id = ObjectIdentifier(a)
                guard Date().timeIntervalSince(settleTried[id] ?? .distantPast) > 2 else { continue }
                settleTried[id] = Date()
                guard let r = InfoPlacement.place(box: box, surfaces: space.surfaces, head: head, metrics: layout.metrics, minShrink: Float(behavior.infoMinShrink), parallel: Float(behavior.floatParallel), relation: relation, probe: probeNow),
                      r.0.settled else { continue }
                Diag.mark("info answer settles: \(r.0.surface.label ?? r.0.surface.id) score \(String(format: "%.2f", r.1?.score ?? 0))")
                Task {
                    await a.move(to: r.0)
                    a.marks?.removeFromParent()
                    let marks = InfoMarks(box: box, text: r.0, eye: head.eye, surfaces: space.surfaces, thickness: Float(behavior.arrowWidth))
                    spaceRoot.addChild(marks); a.marks = marks
                }
                continue
            }
            let id = ObjectIdentifier(a)
            let angles = TextPlacement.viewAngles(p.center, head: head)
            let inView = angles.map { abs($0.x) < TextPlacement.halfFieldH*1.5 && abs($0.y) < TextPlacement.halfFieldV*1.5 } ?? false
            let big = TextPlacement.xHeightDeg(width: p.width, metrics: layout.metrics, at: p.center, up: p.up, eye: head.eye) >= TextPlacement.minDeg*0.7
            let seen = visibleNow([p.center, p.center + p.right*p.width*0.4, p.center - p.right*p.width*0.4]).filter { $0 }.count >= 2
            if inView && big && seen { badSince[id] = nil; continue }
            let since = badSince[id] ?? Date(); badSince[id] = since
            guard Date().timeIntervalSince(since) > 1.5 + 3*behavior.stability else { continue }
            badSince[id] = nil
            let next: PlacedText?
            if let box = a.infoBox {
                next = InfoPlacement.place(box: box, surfaces: space.surfaces, head: head, metrics: layout.metrics, minShrink: Float(behavior.infoMinShrink), parallel: Float(behavior.floatParallel), relation: relation, probe: probeNow)?.0
            } else if a === weatherHost, let t = weatherTarget {
                next = weatherTextPlace(t, metrics: layout.metrics, head: head)
            } else if let p = answerPlace(layout.metrics, head: head) { next = p }
            else {
                // No desk or wall now: it goes over the bar (where an ordinary answer goes without one).
                if barText == nil { hangOverBar(a) }
                continue
            }
            guard let next else { continue }
            Task {
                await a.move(to: next)
                if let box = a.infoBox, let old = a.marks {
                    old.removeFromParent()
                    let marks = InfoMarks(box: box, text: next, eye: head.eye, surfaces: space.surfaces, thickness: Float(behavior.arrowWidth))
                    spaceRoot.addChild(marks); a.marks = marks
                }
            }
        }
    }

    // MARK: Where the user is (Location: editor/scripts/location.py)

    /// Where the user is, in words, under the ask bar: the zone they are in, and one they face. Set only when it changes.
    var locationLabel = ""
    private func showLocation(_ l: Location) {
        let name = { (id: String) in self.space?.semantic.rooms.first { $0.id == id }?.name ?? id }
        var parts: [String] = []
        if let z = l.inZone { parts.append("In \(name(z))") }
        if let f = l.facing { parts.append(f.via == "near" ? "by \(name(f.zone))'s door" : "facing \(name(f.zone)) (\(f.via))") }
        let label = parts.joined(separator: " · ")
        if label != locationLabel { locationLabel = label }
    }

    /// Where the user is now (Location: the zone they are in, one they face through a door or window, by gaze or a pointing finger).
    func location(head: HeadPose) -> Location {
        guard let space else { return Location() }
        var rays: [(o: V3, d: V3, pointing: Bool)] = [(head.eye, head.forward, false)]
        for h in handsInSpace() {
            let along = h.indexTip - h.indexKnuckle
            if along.length >= 0.04, simd_distance(h.indexTip, h.wrist) >= simd_distance(h.indexKnuckle, h.wrist)*1.3 { rays.insert((h.indexTip, along.normalized, true), at: 0) }
        }
        return Location.find(space.semantic, eye: head.eye, rays: rays)
    }

    // MARK: A zone's animation (the lab's diorama)

    @ObservationIgnored private(set) var zoneAnimation: ZoneAnimation?
    /// Each animation's table: where it plays when that table is in view.
    static let animationTables = ["labResearchLife": "lab-table-5", "labResearchWork": "lab-table-5"]
    /// Plays a zone's animation (once per answer): on its zone's central table when it is in view, else on the desk or table the user is
    /// at, else floating within reach, in front of the ask bar and clear of it. Its front faces the user; nothing real hides it (the
    /// room's occlusion is off while it plays); answer text keeps clear of it (TextPlacement.keepClear).
    func showZoneAnimation(_ a: AgentResponse.Animation) async {
        guard zoneAnimation?.animationID != a.id, let space, let m = worldFromSpace, let head = sensing.head() else { return }
        stopZoneAnimation()
        let z = ZoneAnimation(id: a.id)
        guard await z.load() else { Diag.mark("animation \(a.id): not in the app"); return }
        let pose = HeadPose(spaceFromHead: m.inverse*head)
        var at: V3, k: Float, onWhat: String
        func fit(_ s: Surface) -> Float { min(1, 0.92*min(s.width, s.height)/ZoneAnimation.size.x) }
        if let name = Self.animationTables[a.id], let t = space.surfaces.first(where: { $0.objectId == name && $0.normal.y > 0.9 }), inView(t, head: pose) {
            at = t.origin; k = fit(t); onWhat = t.label ?? name
        } else if let (s, p) = WeatherTarget.deskInFront(space.surfaces, head: pose) {
            k = fit(s); onWhat = s.label ?? s.id
            // From where the user looks toward its middle, until the turntable lies on it.
            var c = p, r = ZoneAnimation.size.x*k/2
            for _ in 0..<12 where ![V3(r, 0, 0), V3(-r, 0, 0), V3(0, 0, r), V3(0, 0, -r)].allSatisfy({ s.contains(c + $0) }) { c = c + (s.origin - c)*0.25 }
            if ![V3(r, 0, 0), V3(-r, 0, 0), V3(0, 0, r), V3(0, 0, -r)].allSatisfy({ s.contains(c + $0) }) { c = s.origin; r *= 0.8; k *= 0.8 }
            at = c
        } else {
            var f = pose.forward; f.y = 0; f = f.length > 1e-3 ? f.normalized : V3(0, 0, -1)
            at = pose.eye + f*0.6 + V3(0, -0.36, 0); k = 0.5; onWhat = "floating"
        }
        var toUser = pose.eye - at; toUser.y = 0
        z.transform = Transform(scale: V3(repeating: k), rotation: simd_quatf(angle: yawOf(toUser.length > 1e-3 ? toUser.normalized : V3(0, 0, 1)), axis: worldUp), translation: at + V3(0, 0.004, 0))
        spaceRoot.addChild(z); zoneAnimation = z
        TextPlacement.keepClear = [z.keepClear(scale: k)]
        sensing.occlusion = false   // nothing real hides it while it plays
        Diag.mark("animation \(a.id) on \(onWhat), scale \(String(format: "%.2f", k))")
        // Its text (the answer's own, already shown) goes beside it; any other text over it moves off it.
        if let text = answers.last(where: { $0.infoBox == nil && $0 !== weatherHost }) { putBesideAnimation(text, head: pose) }
        keepAnimationClear(head: pose, now: true)
    }
    /// While an animation plays, no answer's text hides it (or is seen over it) from where the user is: one that does, wherever it is
    /// (over or under the bar too, settled or not), is placed again by its own rules (an info answer by its box, the weather's by the
    /// weather, an ordinary one on a desk or wall) clear of it, else floating aside; text that followed the bar stays where it goes.
    /// Checked when the animation comes and twice a second (the user moves; the bar follows them); each answer at most once a second.
    @ObservationIgnored private var clearedAt: [ObjectIdentifier: Date] = [:]
    func keepAnimationClearNow() {
        guard zoneAnimation != nil, let m = worldFromSpace, let head = sensing.head() else { return }
        keepAnimationClear(head: HeadPose(spaceFromHead: m.inverse*head), now: true)
    }
    private func keepAnimationClear(head: HeadPose, now: Bool = false) {
        guard zoneAnimation != nil, !TextPlacement.keepClear.isEmpty, let space else { return }
        for a in answers + [findmyText].compactMap({ $0 }) {
            guard let layout = a.layout, a.placed != nil else { continue }
            let id = ObjectIdentifier(a)
            if !now, Date().timeIntervalSince(clearedAt[id] ?? .distantPast) < 1 { continue }
            // Its text where it is now, in the space's coordinates (wherever it hangs).
            let b = a.visualBounds(relativeTo: spaceRoot)
            guard !b.isEmpty else { continue }
            let corners = [V3(b.min.x, b.min.y, b.min.z), V3(b.max.x, b.min.y, b.min.z), V3(b.min.x, b.max.y, b.max.z), V3(b.max.x, b.max.y, b.max.z), (b.min + b.max)/2]
            guard TextPlacement.covers(corners, eye: head.eye) else { continue }
            clearedAt[id] = Date()
            var next: PlacedText?
            if a === besideAnimationText, let p = besideAnimation(layout.metrics, head: head) { next = p }
            else if let box = a.infoBox {
                next = InfoPlacement.place(box: box, surfaces: space.surfaces, head: head, metrics: layout.metrics, minShrink: Float(behavior.infoMinShrink), parallel: Float(behavior.floatParallel), relation: relation, probe: probeNow)?.0
            } else if a === weatherHost, let t = weatherTarget {
                next = weatherTextPlace(t, metrics: layout.metrics, head: head)
            } else { next = answerPlace(layout.metrics, head: head) }
            if next.map({ TextPlacement.covers($0, eye: head.eye) }) ?? true { next = TextPlacement.floating(head: head, metrics: layout.metrics) }
            guard let target = next else { continue }
            Diag.mark("text off the animation: to \(target.surface.label ?? target.surface.id)")
            // Text that followed the bar now stays in the room.
            if a.parent !== spaceRoot {
                a.setParent(spaceRoot, preservingWorldTransform: true)
                if a === barText { barText = nil }
                if a === findmyText { findmyText = nil; answers.append(a) }
            }
            Task {
                await a.move(to: target)
                if let box = a.infoBox {
                    a.marks?.removeFromParent()
                    let marks = InfoMarks(box: box, text: target, eye: head.eye, surfaces: space.surfaces, thickness: Float(behavior.arrowWidth))
                    spaceRoot.addChild(marks); a.marks = marks
                }
            }
        }
    }

    /// The text that goes with an animation: beside it, upright and facing the user at its middle height, on whichever side keeps nearer
    /// the middle of the view (never over it); else above it. As wide as reads at that distance.
    @ObservationIgnored private var besideAnimationText: AnswerEntity?
    @ObservationIgnored private var pendingBeside = false
    private func besideAnimation(_ metrics: TextMetrics, head: HeadPose) -> PlacedText? {
        guard let box = TextPlacement.keepClear.first else { return nil }
        var toEye = head.eye - box.center; toEye.y = 0
        guard toEye.length > 1e-3 else { return nil }
        let n = toEye.normalized, right = simd_cross(worldUp, n).normalized
        let distance = simd_distance(head.eye, box.center)
        let width = max(0.22, min(0.8, tan(radians(TextPlacement.targetDeg*metrics.scale))*distance/metrics.xHeightRatio)), height = width*metrics.aspect
        let half = max(box.size.x, box.size.z)/2, gap: Float = 0.05
        var spots: [V3] = [1, -1].map { (side: Float) in box.center + right*(side*(half + gap + width/2)) + V3(0, box.size.y*0.1, 0) }
        spots.sort { abs(TextPlacement.viewAngles($0, head: head)?.x ?? 90) < abs(TextPlacement.viewAngles($1, head: head)?.x ?? 90) }
        spots.append(box.center + V3(0, box.size.y/2 + gap + height/2, 0))
        for c in spots {
            let p = PlacedText(surface: .none, center: c, right: right, up: worldUp, normal: n, width: width, height: height,
                               style: TextStyle(text: SIMD3(1, 1, 1), side: "light", glass: nil, clutter: 0), cost: 0)
            guard !TextPlacement.covers(p, eye: head.eye), let a = TextPlacement.viewAngles(c, head: head), abs(a.x) < TextPlacement.halfFieldH*1.6, abs(a.y) < TextPlacement.halfFieldV*1.6 else { continue }
            return p
        }
        return nil
    }
    /// Moves an answer beside the animation (from the room, or off the bar), its writing going on.
    private func putBesideAnimation(_ a: AnswerEntity, head: HeadPose) {
        guard let layout = a.layout, let p = besideAnimation(layout.metrics, head: head) else { return }
        if a.parent !== spaceRoot { a.setParent(spaceRoot, preservingWorldTransform: true); if a === barText { barText = nil } }
        besideAnimationText = a
        Diag.mark("text beside the animation")
        Task { await a.move(to: p) }
    }

    func stopZoneAnimation() {
        guard let z = zoneAnimation else { return }
        z.removeFromParent(); zoneAnimation = nil; TextPlacement.keepClear = []; besideAnimationText = nil
        sensing.occlusion = behavior.occlusion
    }
    /// Whether a surface is in view: its middle or a corner within ±45° across and ±35° up and down, and in sight.
    private func inView(_ s: Surface, head: HeadPose) -> Bool {
        let pts = [V2(0, 0), V2(-1, -1), V2(1, -1), V2(1, 1), V2(-1, 1)].map { s.point(V2($0.x*s.width*0.4, $0.y*s.height*0.4)) }
        let ahead = pts.filter { TextPlacement.viewAngles($0, head: head).map { abs($0.x) < 45 && abs($0.y) < 35 } ?? false }
        guard !ahead.isEmpty, let m = worldFromSpace, let h = sensing.head() else { return false }
        return sensing.visible(ahead.map { m.point($0) }, from: h.translation, slack: 0.15).contains(true)
    }

    // MARK: FindMy

    @ObservationIgnored private var findmy: FindMyEffect?
    /// The answer is the FindMy mod's (its part came): its text goes under the ask bar.
    @ObservationIgnored private var findmyAnswering = false
    @ObservationIgnored private var findmyText: AnswerEntity?
    private func showFindMy(_ f: FindMyData) async {
        if !findmyAnswering {
            findmyAnswering = true
            // Text already in the room (it came first): it moves under the bar, written in again.
            if let a = answers.last(where: { $0.infoBox == nil && $0 !== weatherHost }), findmyText == nil {
                // Moved under the bar, its writing going on where it was.
                if a === barText { barText = nil }
                answers.removeAll { $0 === a }; findmyText = a
                await hang(a, under: true)
            }
        }
        guard f.status == "found", let t = f.target, findmy?.box.id != "layout:" + t.id else { return }
        findmy?.removeFromParent()
        let e = FindMyEffect(t); spaceRoot.addChild(e); findmy = e
        Diag.mark("findmy: \(f.item_id ?? "-") in \(t.label ?? t.id)")
    }

    // MARK: Questions (replay)

    var pastQuestions: [PastQuestion] = []
    var questionsStatus = ""
    var replaying: String?
    private var replayTask: Task<Void, Never>?

    func loadQuestions() async {
        guard let agent else { questionsStatus = "Not set up: run `visionos/tools/mac.sh prepare` on the Mac and build again."; return }
        questionsStatus = "Loading…"
        do { pastQuestions = try await agent.history(); questionsStatus = pastQuestions.isEmpty ? "No questions asked on the headset yet." : "" }
        catch { questionsStatus = "Failed: \(error.localizedDescription)" }
    }

    /// Replays a question asked before, in the room now, as it happened: nothing for the agent's thinking time, then each part when it
    /// came (the weather's UI, the text's streamed snapshots), seconds after the agent started. The answer is placed where the user
    /// looks now; no new request goes to the agent.
    func replay(_ q: PastQuestion) {
        guard worldFromSpace != nil else { questionsStatus = "Align the layout first."; return }
        replayTask?.cancel(); clearAnswers()
        replaying = q.id; askStatus = "Replaying: \(q.question.text)"
        var events: [(at: Double, apply: (AppModel, inout AnswerEntity?) async -> Void)] = []
        for r in q.responses {
            if let w = r.weather { events.append((r.latency ?? 0, { model, entity in model.startWeather(w, host: entity) })) }
            if let f = r.findmy { events.append((r.latency ?? 0, { model, _ in await model.showFindMy(f) })) }
            if let a = r.animation { events.append((r.latency ?? 0, { model, _ in await model.showZoneAnimation(a) })) }
            if let updates = r.stream?.updates, !updates.isEmpty {
                for u in updates { events.append((u.at, { model, entity in entity = await model.present(title: u.title, body: u.body, info: r.info, streaming: u.status == "streaming", into: entity); model.keepAnimationClearNow() })) }
            } else if !r.title.isEmpty || !r.body.isEmpty {
                events.append((r.latency ?? 0, { model, entity in entity = await model.present(title: r.title, body: r.body, info: r.info, streaming: false, into: entity) }))
            }
        }
        events.sort { $0.at < $1.at }
        replayTask = Task { [weak self] in
            let start = Date()
            var entity: AnswerEntity?
            for e in events {
                let wait = e.at - Date().timeIntervalSince(start)
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                guard !Task.isCancelled, let self else { return }
                await e.apply(self, &entity)
            }
            self?.replaying = nil
        }
    }

    func clearAnswers() {
        for a in answers { a.removeFromParent(); a.marks?.removeFromParent() }
        answers.removeAll(); badSince.removeAll(); lastAnswer = ""; askStatus = ""; stopWeather()
        findmy?.removeFromParent(); findmy = nil
        findmyText?.removeFromParent(); findmyText = nil; findmyAnswering = false
        barText = nil   // removed with the answers
        stopZoneAnimation()
    }

    /// Where an ordinary answer goes (the person–space relation, SpatialRelations, and the desk check the weather uses):
    ///   desk   A, or a desk or table the user stands at: on it (the surface search on that top, anywhere in front; else its clearest
    ///          spot nearest the user), turning to read toward the user
    ///   wall   B: on the wall faced (the surface search on it, near eye level: 20 cm over to 60 cm under the eye; else straight onto
    ///          it where the user faces it, 10 cm under the eye)
    ///   else   nil: the answer goes over the ask bar (showBarText)
    private func answerPlace(_ metrics: TextMetrics, head: HeadPose) -> PlacedText? {
        guard let space else { return nil }
        let S = space.surfaces
        var o = TextPlacement.SearchOptions(); o.minShrink = Float(behavior.infoMinShrink)
        let desk: (Surface, V3)? = relation?.relation == .A ? (relation!.surface, relation!.point) : WeatherTarget.deskInFront(S, head: head)
        if let (s, p) = desk {
            o.only = { $0 === s }; o.prefer = s; o.near = (p, 1.2, { _ in false }); o.field = 3; o.overflow = 1; o.minFacing = 0; o.onSurface = 0.6; o.minShrink = min(o.minShrink, 0.4)
            if let p = TextPlacement.search(in: S, head: head, metrics: metrics, probe: probeNow, options: o).first ?? WeatherText.onTable(s, avoiding: nil, head: head, metrics: metrics),
               !TextPlacement.covers(p, eye: head.eye) { return p }
            return nil
        }
        if let r = relation, r.relation == .B {
            o.only = { $0 === r.surface }; o.prefer = r.surface; o.eyeLevel = true; o.near = (r.point, 1.2, { _ in false }); o.field = 1.4; o.overflow = 0.4; o.minFacing = cos(radians(50))
            // Near eye level: from 20 cm over the eye to 60 cm under it; else straight onto the wall where the user faces it.
            if let p = TextPlacement.search(in: S, head: head, metrics: metrics, probe: probeNow, options: o).first, (-0.6...0.2).contains(p.center.y - head.eye.y) { return p }
            return WeatherText.onWall(r.surface, at: V3(r.point.x, head.eye.y - 0.1, r.point.z), head: head, metrics: metrics).flatMap { TextPlacement.covers($0, eye: head.eye) ? nil : $0 }
        }
        return nil
    }

    /// An ordinary answer with no desk or wall to go on: over the ask bar (over the weather's controls and the settings when they
    /// show), following with it, hand-lettered, written in glyph by glyph, no backing; it grows upward as it streams.
    @ObservationIgnored private var barText: AnswerEntity?
    private func showBarText(title: String, body: String, streaming: Bool) async -> AnswerEntity? {
        let layout = TextLayout(title: title, body: body, settings: TextSettings(bodySize: bodySize, headingSize: Float(behavior.headingSize), showHeading: behavior.showHeading, info: true))
        let distance = (Self.ahead*Self.ahead + Self.below*Self.below).squareRoot()
        let width = tan(radians(TextPlacement.targetDeg*layout.metrics.scale))*distance/layout.metrics.xHeightRatio
        let e: AnswerEntity
        if let b = barText { e = b; e.text = (title, body); await e.setText(layout, streaming: streaming) }
        else {
            if followAnchor.parent == nil { root.addChild(followAnchor) }
            let placed = PlacedText(surface: .none, center: .zero, right: V3(1, 0, 0), up: V3(0, 1, 0), normal: V3(0, 0, 1), width: width, height: width*layout.metrics.aspect,
                                    style: TextStyle(text: SIMD3(1, 1, 1), side: "light", glass: nil, clutter: 0), cost: 0)
            e = AnswerEntity(); e.overlay = true; e.text = (title, body)
            e.writing = .init(on: behavior.writing, strokes: behavior.writingStrokes, speed: behavior.writingSpeed)
            followAnchor.addChild(e); barText = e; answers.append(e)
            await e.show(layout, at: placed, streaming: streaming)
            askStatus = "Answer over the bar"
        }
        // Its bottom stays just over the panels as it grows (the text grows down from the entity's top edge).
        if let p = e.placed { e.position = V3(0, panelsTop + 0.03 + width*layout.metrics.aspect - p.height/2, 0.004) }
        return e
    }

    /// Where text hangs on the bar (the follow anchor's frame): under it (FindMy) or over the panels (an ordinary answer with nowhere
    /// else), facing the user, its x-height the answers' angle at the bar's distance.
    private func barPlacement(_ metrics: TextMetrics, under: Bool) -> PlacedText {
        let distance = (Self.ahead*Self.ahead + Self.below*Self.below).squareRoot()
        let width = tan(radians(TextPlacement.targetDeg*metrics.scale))*distance/metrics.xHeightRatio, height = width*metrics.aspect
        let barBottom: Float = askPanel.map { a in -a.visualBounds(relativeTo: a).extents.y*a.scale.y/2 } ?? -0.03
        let y = under ? barBottom - 0.02 - height/2 : panelsTop + 0.03 + height/2
        return PlacedText(surface: .none, center: V3(0, y, 0.004), right: V3(1, 0, 0), up: V3(0, 1, 0), normal: V3(0, 0, 1),
                          width: width, height: height, style: TextStyle(text: SIMD3(1, 1, 1), side: "light", glass: nil, clutter: 0), cost: 0)
    }
    /// An answer already shown moves onto the bar (under it, or over it), easing there, its writing going on where it was (never
    /// written in again).
    private func hang(_ a: AnswerEntity, under: Bool) async {
        guard let layout = a.layout else { return }
        if followAnchor.parent == nil { root.addChild(followAnchor) }
        a.setParent(followAnchor, preservingWorldTransform: true); a.overlay = true
        await a.move(to: barPlacement(layout.metrics, under: under))
    }
    private func hangOverBar(_ a: AnswerEntity) { barText = a; Task { await hang(a, under: false) } }

    /// The FindMy answer's text under the ask bar, following with it: hand-lettered, written in glyph by glyph, no backing, over
    /// everything real (only the hands cover it); its x-height the answers' angle at the bar's distance. Kept when the bars are hidden
    /// (it is an answer). Updated in place as it streams.
    private func showFindMyText(_ layout: TextLayout, title: String, body: String, streaming: Bool) async -> AnswerEntity? {
        if let e = findmyText { e.text = (title, body); await e.setText(layout, streaming: streaming); return e }
        if followAnchor.parent == nil { root.addChild(followAnchor) }
        let distance = (Self.ahead*Self.ahead + Self.below*Self.below).squareRoot()
        let width = tan(radians(TextPlacement.targetDeg*layout.metrics.scale))*distance/layout.metrics.xHeightRatio, height = width*layout.metrics.aspect
        let barBottom: Float = askPanel.map { a in -a.visualBounds(relativeTo: a).extents.y*a.scale.y/2 } ?? -0.03
        let placed = PlacedText(surface: .none, center: V3(0, barBottom - 0.02 - height/2, 0.004), right: V3(1, 0, 0), up: V3(0, 1, 0), normal: V3(0, 0, 1),
                                width: width, height: height, style: TextStyle(text: SIMD3(1, 1, 1), side: "light", glass: nil, clutter: 0), cost: 0)
        let e = AnswerEntity(); e.overlay = true; e.text = (title, body)
        e.writing = .init(on: behavior.writing, strokes: behavior.writingStrokes, speed: behavior.writingSpeed)
        followAnchor.addChild(e); findmyText = e
        await e.show(layout, at: placed, streaming: streaming)
        askStatus = "FindMy answer under the bar"
        return e
    }

    func stopReplay() { replayTask?.cancel(); replayTask = nil; replaying = nil }

    // MARK: Weather

    /// The entity the weather's controls hang under (the answer's text; nil until there is text: then under the weather itself).
    var weatherHost: AnswerEntity?

    private func startWeather(_ w: WeatherData, host: AnswerEntity? = nil) {
        stopWeather()
        weather = w; weatherIndex = 0; weatherPlaying = true; weatherHost = host; layoutPanels()
        pickWeatherTarget()   // now: the text may be waiting to be placed by it
        weatherTask = Task { [weak self] in
            var last = Date(), lastPick = Date.distantPast
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(33))   // ~30 Hz: the weather's shaders draw each frame
                guard let self, let w = self.weather, !w.entries.isEmpty else { return }
                let now = Date()
                if self.weatherPlaying {
                    self.weatherFraction += now.timeIntervalSince(last)/w.secondsPerPeriod
                    if self.weatherFraction >= 1 { let f = self.weatherFraction; self.weatherIndex = (self.weatherIndex + Int(f)) % w.entries.count; self.weatherFraction = f.truncatingRemainder(dividingBy: 1) }
                }
                last = now
                // Where: picked again once a second as the user looks around, unless locked once placed.
                if now.timeIntervalSince(lastPick) > 1, !(self.weatherLock && self.weatherTarget != nil) { lastPick = now; self.pickWeatherTarget() }
                self.showWeatherEntry()
                if let m = self.worldFromSpace, let head = self.sensing.head() { self.weatherEffect?.update(time: now.timeIntervalSinceReferenceDate, eye: m.inverse.point(head.translation)) }
            }
        }
    }

    private func pickWeatherTarget() {
        guard let space, let m = worldFromSpace, let head = sensing.head() else { return }
        let pose = HeadPose(spaceFromHead: m.inverse * head)
        guard let t = WeatherTarget.select(space.surfaces, head: pose, relation: relation, current: weatherTarget) else { return }
        if let old = weatherTarget, old.same(as: t) { return }
        Diag.mark("weather on \(t.kind) \(t.surface.label ?? t.surface.id) (relation \(relation?.label ?? "none"))")
        weatherTarget = t
        weatherEffect?.removeFromParent(); weatherEffect = nil
        // The weather's text goes with it (hand-lettered, by where the weather now shows).
        if let host = weatherHost {
            let layout = TextLayout(title: host.text.title, body: host.text.body, settings: TextSettings(bodySize: bodySize, headingSize: Float(behavior.headingSize), showHeading: behavior.showHeading, info: true))
            guard let next = weatherTextPlace(t, metrics: layout.metrics, head: pose) else { return }
            // Into the weather's look (from wherever it was before the weather came): moved, its writing going on where it was.
            host.overlay = true
            Task {
                if host.layout?.key != layout.key { await host.setText(layout, streaming: !host.streamingDone) }
                await host.move(to: next)
            }
        }
    }

    /// The weather's text by where the weather shows (WeatherText), else floating.
    private func weatherTextPlace(_ t: WeatherTarget, metrics: TextMetrics, head: HeadPose) -> PlacedText? {
        guard let space else { return nil }
        return WeatherText.place(t, surfaces: space.surfaces, head: head, metrics: metrics, minShrink: Float(behavior.infoMinShrink), parallel: Float(behavior.floatParallel),
                                 relation: relation, probe: probeNow) ?? TextPlacement.floating(head: head, metrics: metrics)
    }

    private func showWeatherEntry() {
        guard let w = weather, let t = weatherTarget, !w.entries.isEmpty else { return }
        let entry = w.entries[min(weatherIndex, w.entries.count - 1)]
        guard weatherEffect?.entryID != entry.id else { return }
        weatherEffect?.removeFromParent()
        let floorY = space?.semantic.rooms.first { $0.id == t.surface.room }?.floorY.map(Float.init)
        let e = WeatherEffect(target: t, entry: entry, floorY: floorY, collide: { [weak self] start in self?.landing(from: start, target: t, floorY: floorY) })
        spaceRoot.addChild(e); weatherEffect = e
    }

    /// Where a drop falling from `start` (space) lands: on the room's mesh (the headset's), else on the lying patch it falls onto, else
    /// on the zone's floor (the layout); with that surface's normal and the fall (m).
    private func landing(from start: V3, target: WeatherTarget, floorY: Float?) -> (point: V3, normal: V3, distance: Float)? {
        if let m = worldFromSpace, let hit = sensing.cast(from: m.point(start), direction: V3(0, -1, 0), length: 4) {
            let inv = m.inverse
            return (inv.point(hit.point), inv.vector(hit.normal).normalized, hit.distance)
        }
        if target.horizontal && target.kind != "ceiling", start.y > target.center.y { return (V3(start.x, target.center.y, start.z), worldUp, start.y - target.center.y) }
        if let floorY, start.y > floorY { return (V3(start.x, floorY, start.z), worldUp, start.y - floorY) }
        return nil
    }

    func stopWeather() {
        weatherTask?.cancel(); weatherTask = nil
        weatherEffect?.removeFromParent(); weatherEffect = nil; weatherTarget = nil; weather = nil; weatherHost = nil
        weatherPanel?.isEnabled = false
    }

    // MARK: Hand gestures

    /// A hand's gesture so far: idle; armed (the palm down and the hand open, held OPEN_HOLD: from then the ball shows); fired (until
    /// the hand opens again or turns).
    enum GestureState { case idle, opening(since: Date), armed(lastOpen: Date), fired }
    @ObservationIgnored private var gestureStates: [Bool: GestureState] = [true: .idle, false: .idle]
    @ObservationIgnored private var lastGesture = Date.distantPast
    @ObservationIgnored private var lastGestureFrame = Date()
    @ObservationIgnored let feedback = GestureFeedback()
    @ObservationIgnored private lazy var balls: [Bool: HandBall] = {
        let l = HandBall(color: UIColor(red: 1, green: 0.82, blue: 0.4, alpha: 1)), r = HandBall(color: UIColor(red: 0.5, green: 0.8, blue: 1, alpha: 1))
        root.addChild(l); root.addChild(r); return [true: l, false: r]
    }()
    /// Where the last gesture was made (world).
    @ObservationIgnored private(set) var gesturePalm: V3 = .zero
    static let openFinger: Float = 1.6, openHold: TimeInterval = 0.2, closedFinger: Float = 1.3, closeWithin: TimeInterval = 1.5
    /// Each frame. A gesture is a hand going from open to a fist with its palm facing down (its normal within ~53° of down), raised (no
    /// lower than 60 cm under the eye):
    ///   armed   the palm down with every finger out (each fingertip OPEN_FINGER × the knuckle's distance from the wrist or more), for
    ///           OPEN_HOLD (the ball shows under the palm from the moment it is seen so: HandBall)
    ///   fired   then, within CLOSE_WITHIN of last being open and with the palm still down, every finger curled in (each under
    ///           CLOSED_FINGER): right hand, voice input; left hand, the bars hidden or shown. The hand must open again for the next.
    /// A pinch or a half-closed hand (scrolling a list, grabbing a panel) never arms it, and at most one fires every 0.8 s.
    private func detectGestures() {
        let poses = sensing.handPoses(), eyeY = sensing.head()?.translation.y ?? 0, now = Date()
        let dt = Float(min(0.1, now.timeIntervalSince(lastGestureFrame))); lastGestureFrame = now
        for left in [true, false] {
            let ball = balls[left]!, t = Float(now.timeIntervalSince(started))
            guard let h = poses.first(where: { $0.left == left }) else {
                // The right hand lost while holding a voice episode: it ends after a moment (not at the first dropped frame).
                if !left, voiceEpisode {
                    if voiceLostSince == nil { voiceLostSince = now }
                    if now.timeIntervalSince(voiceLostSince!) > 0.8 { endVoiceEpisode(); gestureStates[left] = .idle }
                    ball.update(palm: nil, normal: nil, armed: false, progress: 0, dt: dt, time: t); continue
                }
                gestureStates[left] = .idle; ball.update(palm: nil, normal: nil, armed: false, progress: 0, dt: dt, time: t); continue
            }
            if !left { voiceLostSince = nil }
            let down = h.palmNormal.y < -0.6 && h.palm.y > eyeY - 0.6
            let open = h.fingers.allSatisfy { $0 >= Self.openFinger }, closed = h.fingers.allSatisfy { $0 < Self.closedFinger }
            var state = gestureStates[left] ?? .idle
            switch state {
            case .idle: if down && open { state = .opening(since: now) }
            case .opening(let since):
                if !(down && open) { state = .idle } else if now.timeIntervalSince(since) >= Self.openHold { state = .armed(lastOpen: now) }
            case .armed(let lastOpen):
                if !down { state = .idle }
                else if open { state = .armed(lastOpen: now) }
                else if closed && now.timeIntervalSince(lastGesture) > 0.8 {
                    state = .fired; lastGesture = now; gesturePalm = h.palm; ball.fire()
                    if left { barsHidden.toggle(); layoutPanels(); feedback.play(barsHidden ? .barsHidden : .barsShown) } else { startVoiceEpisode() }
                } else if now.timeIntervalSince(lastOpen) > Self.closeWithin { state = .idle }
            case .fired:
                // The right fist holds the voice episode however the hand turns; it ends when the hand opens.
                if h.curl > Self.openFinger { state = .idle; if !left { endVoiceEpisode() } }
                else if left && !down { state = .idle }
            }
            if !left, voiceEpisode { placeVoiceCaption(h) }
            gestureStates[left] = state
            // The ball: from the moment the palm is down with the hand open (and while it closes from there).
            var armed = false; switch state { case .opening, .armed: armed = true; default: break }
            // How far it has closed: the mean finger from open (1.85) to curled.
            let progress = (1.85 - h.curl)/(1.85 - Self.closedFinger)
            ball.update(palm: h.palm, normal: h.palmNormal, armed: armed, progress: progress, dt: dt, time: t)
        }
    }
    /// The right fist made: a tone, then listening (held: no pause ends it) once the tone has played (it is not to be heard as speech).
    private func startVoiceEpisode() {
        guard !voiceEpisode else { return }
        if speech.listening { speech.stop() }
        voiceEpisode = true; noteInteraction(); feedback.play(.voiceOn)
        Task { try? await Task.sleep(for: .milliseconds(250)); if voiceEpisode { speech.start(hold: true) } }
    }
    /// The fist let go: what was said is asked (SpeechInput.onFinish), with a falling tone.
    private func endVoiceEpisode() {
        guard voiceEpisode else { return }
        voiceEpisode = false; speech.end(); feedback.play(.voiceOff)
        voiceCaption?.isEnabled = false
    }
    /// What is heard, floating over the back of the right hand (VOICE_LIFT above it, against the palm's normal), turned to the eye.
    static let voiceLift: Float = 0.07, voiceWidth: Float = 0.16
    private func placeVoiceCaption(_ h: WorldSensing.HandPose) {
        guard let c = voiceCaption else { return }
        if c.parent !== root { root.addChild(c); c.components.set(BillboardComponent()) }
        let size = c.visualBounds(relativeTo: c).extents
        if size.x > 0 { c.scale = V3(repeating: Self.voiceWidth/size.x) }
        c.position = h.palm - h.palmNormal*Self.voiceLift + V3(0, 0.02, 0)
        c.isEnabled = true
    }
    func attachVoiceCaption(_ e: Entity?) { if let e, voiceCaption !== e { voiceCaption = e; e.isEnabled = false } }

    // MARK: Panels in the room (the ask bar, the weather's controls)

    /// The question bar and, above it, the weather's controls (SwiftUI attachments), within easy reach: 35 cm ahead and 40 cm below the
    /// eye, tilted up to face it, so the hands work them without lifting. They follow the user (Behavior: follow): lazily, still while
    /// the head moves a little and gliding back in front once the user has turned more than FOLLOW_TURN or moved FOLLOW_MOVE; or in
    /// real time, eased. Never while the user is working them: a hand within 20 cm of them, or a tap or drag in the last 3 s.
    static let followTurn: Float = radians(25), followMove: Float = 0.4, askWidth: Float = 0.2, weatherWidth: Float = 0.3, settingsWidth: Float = 0.3
    static let ahead: Float = 0.35, below: Float = 0.4, settingsLean: Float = radians(15)
    @ObservationIgnored private var lastInteraction = Date.distantPast
    /// A tap or drag on the bar or the weather's controls: they hold still for a moment.
    func noteInteraction() { lastInteraction = Date() }
    @ObservationIgnored private let followAnchor = Entity()
    @ObservationIgnored private var followPlaced = false
    @ObservationIgnored private var glide: (from: Transform, to: Transform, start: Date)?
    @ObservationIgnored private weak var askPanel: Entity?
    @ObservationIgnored private weak var weatherPanel: Entity?
    @ObservationIgnored private weak var settingsPanel: Entity?
    @ObservationIgnored private var panelsLaidOut = false   // the ask bar's size known (an attachment has none until laid out)

    /// Takes the attachments' entities (RealityView's update) and lays them out on the follow anchor.
    func attachPanels(ask: Entity?, weather: Entity?, settings: Entity?) {
        Diag.time("attach panels") { attachPanelsNow(ask: ask, weather: weather, settings: settings) }
    }
    private func attachPanelsNow(ask: Entity?, weather: Entity?, settings: Entity?) {
        if followAnchor.parent == nil { root.addChild(followAnchor) }
        for p in [ask, weather, settings].compactMap({ $0 }) where p.parent !== followAnchor { followAnchor.addChild(p) }
        askPanel = ask; weatherPanel = weather; settingsPanel = settings
        layoutPanels()
    }
    private func layoutPanels() {
        var top: Float = 0, outline: [V3] = []
        func box(_ c: V3, _ w: Float, _ h: Float) -> [V3] { [(-1, -1), (1, -1), (1, 1), (-1, 1)].map { (x: Float, y: Float) in c + V3(x*w/2, y*h/2, 0) } }
        if let a = askPanel {
            a.isEnabled = !barsHidden
            let size = a.visualBounds(relativeTo: a).extents
            if size.x > 0 { let k = Self.askWidth/size.x; a.scale = V3(repeating: k); a.position = .zero; top = size.y*k/2; panelsLaidOut = true; if a.isEnabled { outline += box(.zero, Self.askWidth, size.y*k) } }
        }
        if let w = weatherPanel {
            w.isEnabled = weather != nil   // the left hand hides the controls (bar, settings), not the weather's
            let size = w.visualBounds(relativeTo: w).extents
            if size.x > 0, weather != nil {
                let k = Self.weatherWidth/size.x; w.scale = V3(repeating: k); w.position = V3(0, top + 0.03 + size.y*k/2, 0); top += 0.03 + size.y*k
                if w.isEnabled { outline += box(w.position, Self.weatherWidth, size.y*k) }
            }
        }
        if let s = settingsPanel {
            s.isEnabled = settingsInRoom && !barsHidden
            let size = s.visualBounds(relativeTo: s).extents
            if size.x > 0 {
                // Hinged on the top of what is below it and stood up toward the user: leaning back SETTINGS_LEAN from upright (the bar
                // itself leans back much more, facing the eye from below). Dragged by its grip, it keeps where it was put (in the
                // bar's frame: it still follows).
                let k = Self.settingsWidth/size.x, tilt = atan2(Self.below, Self.ahead), turn = simd_quatf(angle: tilt - Self.settingsLean, axis: V3(1, 0, 0))
                let half = V3(Self.settingsWidth/2, size.y*k/2, 0)
                s.scale = V3(repeating: k); s.orientation = turn
                s.position = settingsOffset ?? V3(0, top + 0.03, 0) + turn.act(V3(0, half.y, 0))
                settingsGripOffset = turn.act(V3(0, half.y + 0.025, 0))
                settingsGrip.position = s.position + settingsGripOffset; settingsGrip.orientation = turn
                if settingsGrip.parent !== followAnchor { followAnchor.addChild(settingsGrip) }
                if s.isEnabled { outline += [(-1, -1), (1, -1), (1, 1), (-1, 1)].map { (x: Float, y: Float) in s.position + turn.act(V3(x*half.x, y*half.y, 0)) } }
            }
            settingsGrip.isEnabled = s.isEnabled
        }
        panelOutline = outline; panelsTop = top + (settingsPanel?.isEnabled == true ? 0.03 + (settingsPanel.map { $0.visualBounds(relativeTo: $0).extents.y*$0.scale.y } ?? 0) : 0)
    }

    /// The settings' grip: a bar along its top edge, grabbed and dragged by hand (RoomView's drag gesture).
    @ObservationIgnored lazy var settingsGrip: ModelEntity = {
        var m = UnlitMaterial(color: .white); m.blending = .transparent(opacity: .init(floatLiteral: 0.6))
        let e = ModelEntity(mesh: .generatePlane(width: 0.1, height: 0.012, cornerRadius: 0.006), materials: [m])
        e.components.set(CollisionComponent(shapes: [.generateBox(size: V3(0.16, 0.05, 0.03))]))
        e.components.set(InputTargetComponent()); e.components.set(HoverEffectComponent())
        return e
    }()
    @ObservationIgnored private var settingsOffset: V3?
    @ObservationIgnored private var settingsGripOffset = V3.zero
    /// The grip dragged to a point (world): the settings follow it.
    func dragSettings(to world: V3) {
        noteInteraction()
        settingsOffset = followAnchor.transformMatrix(relativeTo: nil).inverse.point(world) - settingsGripOffset
        layoutPanels()
    }
    /// The panels' corners in the follow anchor's frame (the enabled ones): kept in plain sight (followPanels).
    @ObservationIgnored private var panelOutline: [V3] = []
    /// The top of the panels in the follow anchor's frame (the bar, the weather's controls, the settings).
    @ObservationIgnored private var panelsTop: Float = 0.03

    /// Where the panels may sit, in turn (ahead, below the eye): the usual place first; when something real (the room's mesh: a desk, a
    /// shelf) would be in the way of any of their corners, higher and nearer, until none is.
    static let placements: [(ahead: Float, below: Float)] = [(0.35, 0.4), (0.35, 0.32), (0.33, 0.24), (0.3, 0.16), (0.28, 0.09)]
    @ObservationIgnored private var placement = 0
    @ObservationIgnored private var lastClearCheck = Date.distantPast

    private func panelTarget(_ eye: V3, _ f: V3, _ i: Int) -> Transform {
        let at = eye + f*Self.placements[i].ahead + V3(0, -Self.placements[i].below, 0)
        let n = (eye - at).normalized, right = simd_cross(worldUp, n).normalized, up = simd_cross(n, right)
        return Transform(matrix: simd_float4x4(right: right, up: up, normal: n, origin: at))
    }
    private func clear(_ t: Transform, eye: V3) -> Bool {
        let m = t.matrix, pts = panelOutline.map { m.point($0) }
        return pts.isEmpty || sensing.visible(pts, from: eye).allSatisfy { $0 }
    }

    /// Each frame: where the panels should be for this head, and whether they should go there now.
    private func followPanels(head: simd_float4x4) {
        if !panelsLaidOut { layoutPanels() }
        var f = -head.zAxis; f.y = 0; f = f.length > 1e-3 ? f.normalized : V3(0, 0, -1)
        let eye = head.translation
        // Five times a second: the first clear place; and if real things now hide the panels where they are, they go there.
        var blocked = false
        if Date().timeIntervalSince(lastClearCheck) > 0.2 {
            lastClearCheck = Date()
            placement = Self.placements.indices.first { clear(panelTarget(eye, f, $0), eye: eye) } ?? Self.placements.count - 1
            blocked = followPlaced && !clear(followAnchor.transform, eye: eye)
        }
        let target = panelTarget(eye, f, placement)
        if !followPlaced { followAnchor.transform = target; followPlaced = true; return }
        if blocked && glide == nil { glide = (followAnchor.transform, target, Date()); return }
        // In use: hold still.
        let panels = [askPanel, weatherPanel, settingsPanel].compactMap { $0 }.filter(\.isEnabled).map { p in
            (p.position(relativeTo: nil), max(0.2, p.visualBounds(relativeTo: nil).extents.y/2 + 0.08))
        }
        let working = Date().timeIntervalSince(lastInteraction) < 3 || sensing.hands().flatMap(\.joints).contains { j in panels.contains { simd_distance(j, $0.0) < $0.1 } }
        if working { glide = nil; return }
        if behavior.followMode == "realtime" {
            let k: Float = 0.15   // eased: a fraction of the way each frame
            followAnchor.transform = Transform(scale: .one, rotation: simd_slerp(followAnchor.transform.rotation, target.rotation, k),
                                               translation: simd_mix(followAnchor.position, target.translation, V3(repeating: k)))
            return
        }
        if let g = glide {
            let t = Float(min(1, Date().timeIntervalSince(g.start)/0.5)), e = t*t*(3 - 2*t)
            followAnchor.transform = Transform(scale: .one, rotation: simd_slerp(g.from.rotation, g.to.rotation, e), translation: simd_mix(g.from.translation, g.to.translation, V3(repeating: e)))
            if t >= 1 { glide = nil }
            return
        }
        var toPanel = followAnchor.position - eye; toPanel.y = 0
        let turned = toPanel.length > 1e-3 ? acos(min(1, max(-1, simd_dot(toPanel.normalized, f)))) : 0
        let at = target.translation, moved = simd_distance(followAnchor.position, at)
        if turned > Self.followTurn || moved > Self.followMove || abs(followAnchor.position.y - at.y) > 0.25 {
            glide = (followAnchor.transform, target, Date())
        }
    }
}
