import ARKit
import RealityKit
import QuartzCore
import simd

/// What the headset knows of the room (ARKit): its own pose, the planes it finds (walls, floor, tables, doors: for aligning the layout),
/// the room's mesh (made into collision shapes under `meshRoot`, for checking that answer text is not hidden), and the world anchor
/// holding the saved alignment. Providers the device (or the simulator) does not support are left out.
@MainActor
@Observable
final class WorldSensing {
    @ObservationIgnored let session = ARKitSession()
    @ObservationIgnored let world = WorldTrackingProvider()
    @ObservationIgnored let planes = PlaneDetectionProvider(alignments: [.horizontal, .vertical])
    @ObservationIgnored let sceneMesh = SceneReconstructionProvider(modes: [.classification])   // faces classified: ICP uses the walls and floor
    @ObservationIgnored let handTracking = HandTrackingProvider()
    @ObservationIgnored let meshRoot = Entity()
    @ObservationIgnored private(set) var planeAnchors: [UUID: PlaneAnchor] = [:]
    @ObservationIgnored private var meshEntities: [UUID: Entity] = [:]
    @ObservationIgnored private(set) var meshAnchors: [UUID: MeshAnchor] = [:]
    private(set) var status = "Not started"
    /// Called when a world anchor is added or updated (the saved alignment coming back).
    @ObservationIgnored var onWorldAnchor: ((WorldAnchor) -> Void)?

    func start() async {
        var providers: [any DataProvider] = []
        if WorldTrackingProvider.isSupported { providers.append(world) }
        if PlaneDetectionProvider.isSupported { providers.append(planes) }
        if SceneReconstructionProvider.isSupported { providers.append(sceneMesh) }
        guard !providers.isEmpty else { status = "World sensing is not available here (simulator?)."; return }
        let auth = await session.requestAuthorization(for: [.worldSensing, .handTracking])
        if HandTrackingProvider.isSupported, auth[.handTracking] == .allowed { providers.append(handTracking) }
        guard auth[.worldSensing] == .allowed else { status = "World sensing was not allowed."; return }
        do { try await session.run(providers) } catch { status = "ARKit failed to start: \(error.localizedDescription)"; return }
        status = "Running"
        if providers.contains(where: { $0 === planes }) { Task { await watchPlanes() } }
        if providers.contains(where: { $0 === sceneMesh }) { Task { await watchMesh() } }
        if providers.contains(where: { $0 === world }) { Task { await watchWorldAnchors() } }
        Task { while !Task.isCancelled { summarize(); try? await Task.sleep(for: .seconds(1)) } }
    }

    private func watchPlanes() async {
        for await update in planes.anchorUpdates {
            switch update.event {
            case .added, .updated: Diag.time("plane anchor") { planeAnchors[update.anchor.id] = update.anchor }
            case .removed: planeAnchors[update.anchor.id] = nil
            @unknown default: break
            }
        }
    }

    // The room's mesh, as it comes in. Making its collision shapes is heavy and the mesh arrives in bursts (most of it in the first
    // seconds): each piece is rebuilt at most every MESH_REBUILD seconds, off the main thread, so the windows stay responsive.
    static let meshRebuild: TimeInterval = 2
    @ObservationIgnored private var meshBuilt: [UUID: Date] = [:]
    @ObservationIgnored private var meshPending: Set<UUID> = []
    @ObservationIgnored private var meshPieces = 0
    @ObservationIgnored private var meshMarked = 0
    @ObservationIgnored private var lastMeshArrival: Date?

    private func watchMesh() async {
        for await update in sceneMesh.anchorUpdates {
            let anchor = update.anchor
            switch update.event {
            case .added, .updated:
                if update.event == .added { lastMeshArrival = Date() }
                meshAnchors[anchor.id] = anchor
                if let built = meshBuilt[anchor.id], Date().timeIntervalSince(built) < Self.meshRebuild { continue }
                guard !meshPending.contains(anchor.id) else { continue }
                meshPending.insert(anchor.id); meshBuilt[anchor.id] = Date()
                Task.detached(priority: .utility) { [weak self] in
                    let shape = try? await ShapeResource.generateStaticMesh(from: anchor)
                    let occluder = Self.descriptor(anchor)
                    await self?.finishMesh(anchor, shape, occluder)
                }
            case .removed:
                meshAnchors[anchor.id] = nil
                meshEntities[anchor.id]?.removeFromParent(); meshEntities[anchor.id] = nil; meshBuilt[anchor.id] = nil; occluders[anchor.id] = nil; meshPieces = meshEntities.count
            @unknown default: break
            }
        }
    }

    private func finishMesh(_ anchor: MeshAnchor, _ shape: ShapeResource?, _ occluder: MeshDescriptor?) {
        Diag.time("mesh piece in") { finishMeshNow(anchor, shape, occluder) }
    }
    private func finishMeshNow(_ anchor: MeshAnchor, _ shape: ShapeResource?, _ occluder: MeshDescriptor?) {
        meshPending.remove(anchor.id)
        guard let shape else { return }
        let e = meshEntities[anchor.id] ?? { let e = Entity(); meshRoot.addChild(e); meshEntities[anchor.id] = e; return e }()
        e.transform = Transform(matrix: anchor.originFromAnchorTransform)
        e.components.set(CollisionComponent(shapes: [shape], isStatic: true))
        // The real room hides what is behind it: the mesh drawn invisibly, into depth only.
        // Made without holding up the main thread (it stalled the app ~0.4 s each time a piece was rebuilt).
        if let occluder {
            Task { [weak self] in
                guard let mesh = try? await MeshResource(from: [occluder]), let self, self.meshEntities[anchor.id] === e else { return }
                self.occluders[anchor.id] = mesh
                if self.occlusion { e.components.set(ModelComponent(mesh: mesh, materials: [OcclusionMaterial()])) }
            }
        }
        meshPieces = meshEntities.count
        if meshPieces/10 != meshMarked/10 { meshMarked = meshPieces; Diag.mark("room mesh: \(meshPieces) pieces") }
    }

    /// Whether real things hide the app's content (the room's mesh as an occluder). Collision stays either way.
    /// Off, the occluders are taken out altogether (a model left without materials draws RealityKit's pink "missing material" stripes).
    var occlusion = true {
        didSet {
            guard occlusion != oldValue else { return }
            for (id, e) in meshEntities {
                if occlusion, let mesh = occluders[id] { e.components.set(ModelComponent(mesh: mesh, materials: [OcclusionMaterial()])) }
                else { e.components.remove(ModelComponent.self) }
            }
        }
    }
    @ObservationIgnored private var occluders: [UUID: MeshResource] = [:]

    /// A mesh piece's triangles as a mesh descriptor (its own coordinates).
    nonisolated static func descriptor(_ anchor: MeshAnchor) -> MeshDescriptor? {
        let g = anchor.geometry, v = g.vertices, f = g.faces
        guard v.format == .float3, f.bytesPerIndex == 4 || f.bytesPerIndex == 2 else { return nil }
        var positions: [SIMD3<Float>] = []; positions.reserveCapacity(v.count)
        let vb = v.buffer.contents().advanced(by: v.offset)
        for i in 0..<v.count { let p = vb.advanced(by: i*v.stride).assumingMemoryBound(to: Float.self); positions.append(SIMD3(p[0], p[1], p[2])) }
        var indices: [UInt32] = []; let n = f.count*f.primitive.indexCount; indices.reserveCapacity(n)
        let fb = f.buffer.contents()
        for i in 0..<n { indices.append(f.bytesPerIndex == 4 ? fb.load(fromByteOffset: i*4, as: UInt32.self) : UInt32(fb.load(fromByteOffset: i*2, as: UInt16.self))) }
        var d = MeshDescriptor(name: "room"); d.positions = MeshBuffers.Positions(positions); d.primitives = .triangles(indices)
        return d
    }

    /// The room's mesh as points (world) with their normals, one per `spacing` cube, at most `cap` (evenly thinned): for fine alignment
    /// (ICPRefiner). `structure`: only the room's own shell, as ARKit classifies the mesh's faces (walls, floor, doors, windows), not
    /// what stands in it (tables, seats, clutter: unclassified). Off the main thread.
    func meshSamples(spacing: Float = 0.05, cap: Int = 30000, structure: Bool) async -> [(p: V3, n: V3)] {
        let anchors = Array(meshAnchors.values)
        return await Task.detached(priority: .userInitiated) { Self.samples(anchors, spacing: spacing, cap: cap, structure: structure) }.value
    }
    nonisolated static func samples(_ anchors: [MeshAnchor], spacing: Float, cap: Int, structure: Bool) -> [(p: V3, n: V3)] {
        var cells: [SIMD3<Int32>: (p: V3, n: V3)] = [:]
        let shell: Set<MeshAnchor.MeshClassification> = [.wall, .floor, .door, .window]
        for a in anchors {
            let g = a.geometry, v = g.vertices, nm = g.normals, m = a.originFromAnchorTransform
            guard v.format == .float3 else { continue }
            var keep: [Bool]? = nil
            if structure {
                // A vertex is the shell's when a face of the shell uses it.
                guard let c = g.classifications, c.format == .uchar, c.count == g.faces.count else { continue }
                var k = [Bool](repeating: false, count: v.count)
                let cb = c.buffer.contents().advanced(by: c.offset), f = g.faces, fb = f.buffer.contents(), per = f.primitive.indexCount
                for face in 0..<f.count {
                    guard let cls = MeshAnchor.MeshClassification(rawValue: Int(cb.load(fromByteOffset: face*c.stride, as: UInt8.self))), shell.contains(cls) else { continue }
                    for j in 0..<per {
                        let i = face*per + j, idx = f.bytesPerIndex == 4 ? Int(fb.load(fromByteOffset: i*4, as: UInt32.self)) : Int(fb.load(fromByteOffset: i*2, as: UInt16.self))
                        if idx < k.count { k[idx] = true }
                    }
                }
                keep = k
            }
            let vb = v.buffer.contents().advanced(by: v.offset), nb = nm.buffer.contents().advanced(by: nm.offset), hasN = nm.format == .float3 && nm.count == v.count
            for i in 0..<v.count {
                if let keep, !keep[i] { continue }
                let p = vb.advanced(by: i*v.stride).assumingMemoryBound(to: Float.self), w = m.point(V3(p[0], p[1], p[2]))
                let key = SIMD3<Int32>(Int32(floor(w.x/spacing)), Int32(floor(w.y/spacing)), Int32(floor(w.z/spacing)))
                guard cells[key] == nil else { continue }
                var n = V3.zero
                if hasN { let q = nb.advanced(by: i*nm.stride).assumingMemoryBound(to: Float.self); n = m.vector(V3(q[0], q[1], q[2])).normalized }
                cells[key] = (w, n)
            }
        }
        let all = Array(cells.values), every = max(1, all.count/cap)
        return stride(from: 0, to: all.count, by: every).map { all[$0] }
    }

    /// The room's state for the indicator, refreshed once a second (not on every ARKit update: that would redraw the windows constantly):
    /// the mesh scanning or ready (a few pieces in, none new for 3 s), and the walls, floors and tables found (for aligning).
    struct RoomState: Equatable { var meshPieces = 0; var meshReady = false; var walls = 0; var floors = 0; var tables = 0 }
    private(set) var room = RoomState()
    private func summarize() {
        let kinds = planeAnchors.values.map(\.surfaceClassification)
        let next = RoomState(meshPieces: meshPieces, meshReady: meshPieces >= 3 && (lastMeshArrival.map { Date().timeIntervalSince($0) > 3 } ?? false),
                             walls: kinds.filter { $0 == .wall }.count, floors: kinds.filter { $0 == .floor }.count, tables: kinds.filter { $0 == .table }.count)
        if next != room { room = next }
    }

    private func watchWorldAnchors() async {
        for await update in world.anchorUpdates {
            if update.event != .removed { onWorldAnchor?(update.anchor) }
        }
    }

    /// The head's pose now (world), if tracked.
    func head() -> simd_float4x4? {
        guard world.state == .running, let a = world.queryDeviceAnchor(atTimestamp: CACurrentMediaTime()), a.isTracked else { return nil }
        return a.originFromAnchorTransform
    }

    /// The hands now (world): for each tracked hand, its joints that selection uses (src/user-selection.mjs: wrist, the index finger's
    /// knuckle and tip, and every joint for touching). Empty without hand tracking.
    typealias Hand = HandJoints
    func hands() -> [Hand] {
        guard handTracking.state == .running else { return [] }
        let latest = handTracking.latestAnchors
        return [latest.leftHand, latest.rightHand].compactMap { a -> Hand? in
            guard let a, a.isTracked, let sk = a.handSkeleton else { return nil }
            let at = { (j: HandSkeleton.JointName) -> V3 in (a.originFromAnchorTransform*sk.joint(j).anchorFromJointTransform).translation }
            return Hand(wrist: at(.wrist), indexKnuckle: at(.indexFingerKnuckle), indexTip: at(.indexFingerTip),
                        joints: HandSkeleton.JointName.allCases.filter { sk.joint($0).isTracked }.map(at))
        }
    }

    /// Each tracked hand for gestures: which hand, its palm's normal (out of the palm, world), how closed it is (`curl`: the four
    /// fingertips' mean distance from the wrist over the middle knuckle's; about 1.9 open, 1.1 in a fist; `fingers`: each one's), the palm's centre, and its
    /// outline as chains of joints (each finger from the wrist, and across the knuckles), world. The palm's normal from the wrist and the
    /// index and little finger knuckles.
    struct HandPose { let left: Bool; let palmNormal: V3; let curl: Float; let fingers: [Float]; let palm: V3; let chains: [[V3]] }
    static let chains: [[HandSkeleton.JointName]] = [
        [.wrist, .thumbKnuckle, .thumbIntermediateBase, .thumbIntermediateTip, .thumbTip],
        [.wrist, .indexFingerMetacarpal, .indexFingerKnuckle, .indexFingerIntermediateBase, .indexFingerIntermediateTip, .indexFingerTip],
        [.wrist, .middleFingerMetacarpal, .middleFingerKnuckle, .middleFingerIntermediateBase, .middleFingerIntermediateTip, .middleFingerTip],
        [.wrist, .ringFingerMetacarpal, .ringFingerKnuckle, .ringFingerIntermediateBase, .ringFingerIntermediateTip, .ringFingerTip],
        [.wrist, .littleFingerMetacarpal, .littleFingerKnuckle, .littleFingerIntermediateBase, .littleFingerIntermediateTip, .littleFingerTip],
        [.indexFingerKnuckle, .middleFingerKnuckle, .ringFingerKnuckle, .littleFingerKnuckle],
    ]
    func handPoses() -> [HandPose] {
        guard handTracking.state == .running else { return [] }
        let latest = handTracking.latestAnchors
        return [latest.leftHand, latest.rightHand].compactMap { a -> HandPose? in
            guard let a, a.isTracked, let sk = a.handSkeleton else { return nil }
            let at = { (j: HandSkeleton.JointName) -> V3 in (a.originFromAnchorTransform*sk.joint(j).anchorFromJointTransform).translation }
            let wrist = at(.wrist), knuckle = at(.middleFingerKnuckle), cross = simd_cross(at(.indexFingerKnuckle) - wrist, at(.littleFingerKnuckle) - wrist).normalized
            let left = a.chirality == .left, palm = left ? -cross : cross   // the right hand's index × little points out of its palm
            let reach = simd_distance(knuckle, wrist)
            let tips: [HandSkeleton.JointName] = [.indexFingerTip, .middleFingerTip, .ringFingerTip, .littleFingerTip]
            let fingers = tips.map { reach > 1e-3 ? simd_distance(at($0), wrist)/reach : 2 }   // each finger: about 1.9 out, 1.1 curled in
            let curl = fingers.reduce(0, +)/Float(fingers.count)
            return HandPose(left: left, palmNormal: palm, curl: curl, fingers: fingers, palm: (wrist + knuckle)/2 + palm*0.03, chains: Self.chains.map { $0.map(at) })
        }
    }

    /// The planes found so far (world): centre, normal (the anchor's +y), extent and kind.
    func observations() -> [PlaneObservation] {
        planeAnchors.values.map { a in
            let m = a.originFromAnchorTransform * a.geometry.extent.anchorFromExtentTransform
            let kind: PlaneObservation.Kind = switch a.surfaceClassification {
                case .wall: .wall
                case .floor: .floor
                case .ceiling: .ceiling
                case .table: .table
                case .seat: .seat
                case .door: .door
                case .window: .window
                default: .other
            }
            return PlaneObservation(center: m.translation, normal: a.originFromAnchorTransform.yAxis.normalized,
                                    width: a.geometry.extent.width, height: a.geometry.extent.height, kind: kind)
        }
    }

    /// Whether each point (world) is in plain sight from `eye`: no part of the room's mesh within the way (5 cm short of it).
    /// `slack`: how far in front of a point the mesh may be and the point still count (the alignment's error, a flat thing on a surface).
    func visible(_ points: [V3], from eye: V3, slack: Float = 0.05) -> [Bool] {
        Diag.time("raycasts: visible ×\(points.count)") { visibleNow(points, from: eye, slack: slack) }
    }
    private func visibleNow(_ points: [V3], from eye: V3, slack: Float) -> [Bool] {
        guard let scene = meshRoot.scene, !meshEntities.isEmpty else { return points.map { _ in true } }
        return points.map { p in
            let d = p - eye, l = d.length
            guard l > slack + 0.01 else { return true }
            return scene.raycast(origin: eye, direction: d/l, length: l - slack, query: .nearest, mask: .all, relativeTo: nil).isEmpty
        }
    }

    /// For each point (world): how far in front of it the room's mesh is along the ray from `eye` (negative: the mesh is behind it, up
    /// to 30 cm), nil where the mesh has nothing on that ray (or there is no mesh).
    func inFront(_ points: [V3], from eye: V3) -> [Float?] {
        Diag.time("raycasts: in front ×\(points.count)") { inFrontNow(points, from: eye) }
    }
    private func inFrontNow(_ points: [V3], from eye: V3) -> [Float?] {
        guard let scene = meshRoot.scene, !meshEntities.isEmpty else { return points.map { _ in nil } }
        return points.map { p in
            let d = p - eye, l = d.length
            guard l > 0.06, let hit = scene.raycast(origin: eye, direction: d/l, length: l + 0.3, query: .nearest, mask: .all, relativeTo: nil).first else { return nil }
            return l - hit.distance
        }
    }

    /// Where a ray (world) first meets the room's mesh: point, normal, distance; nil when nothing is within `length` (or no mesh yet).
    func cast(from origin: V3, direction: V3, length: Float) -> (point: V3, normal: V3, distance: Float)? {
        guard let scene = meshRoot.scene, !meshEntities.isEmpty,
              let hit = scene.raycast(origin: origin, direction: direction, length: length, query: .nearest, mask: .all, relativeTo: nil).first else { return nil }
        return (hit.position, hit.normal, hit.distance)
    }

    /// Replaces the saved alignment's world anchor; returns the new anchor's id.
    func saveAnchor(_ worldFromSpace: simd_float4x4, replacing old: UUID?) async throws -> UUID {
        if let old { try? await world.removeAnchor(forID: old) }
        let anchor = WorldAnchor(originFromAnchorTransform: worldFromSpace)
        try await world.addAnchor(anchor)
        return anchor.id
    }
}
