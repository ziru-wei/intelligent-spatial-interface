import Foundation
import RealityKit
import simd

/// A zone's animation (the agent's 'animation' part: the Programmable Reality Lab's dioramas from vision-animation-3d: labResearchLife.usdz,
/// on its requirements, life and how it researches (LabDiorama), and labResearchWork.usdz, on what it researches (RealityDiorama)),
/// played in a loop where AppModel puts it. Its front (+z) faces the user.
///   chapters  the turntable's four stations (sub-discs S1-S4) each come to the front in turn. A hand touching one (any joint within its
///             disc, just over it) plays that chapter now (from where the turntable turns to it), and the loop goes on from there.
@MainActor
final class ZoneAnimation: Entity {
    /// Each station's entity and when its chapter starts (seconds: the frame the turntable starts turning to it, at 30 fps).
    static let chapters: [String: [(name: String, start: TimeInterval)]] = [
        "labResearchLife": [("S1_Writing", 140.0/30), ("S2_Papers", 250.0/30), ("S3_Culture", 372.0/30), ("S4_Internship", 478.0/30)],
        // The research one turns a quarter every 5 s, each station in front for 4 s (frames 1-121, 151-271, 301-421, 451-571).
        "labResearchWork": [("S1_ARVR", 0), ("S2_Robotics", 121.0/30), ("S3_ShapeChange", 271.0/30), ("S4_LivingIn", 421.0/30)],
    ]
    /// Its footprint at scale 1 (metres): a 0.7 m turntable, 0.48 m tall.
    static let size = V3(0.72, 0.5, 0.72)
    static let padRadius: Float = 0.095, touchAbove: Float = 0.06

    let animationID: String
    private var model: Entity?
    private var controller: AnimationPlaybackController?
    private var lastTouch = Date.distantPast

    required init() { animationID = ""; super.init() }
    init(id: String) { animationID = id; super.init() }

    /// Loads and starts it (looping). False when the app has no such animation.
    func load() async -> Bool {
        guard let m = try? await Entity(named: animationID) else { return false }
        model = m; addChild(m)
        if let a = m.availableAnimations.first { controller = m.playAnimation(a.repeat()) }
        return true
    }

    /// Each frame: a hand touching a station's disc plays its chapter. Hands: world joints.
    func update(hands: [HandJoints]) {
        guard let model, let chapters = Self.chapters[animationID], Date().timeIntervalSince(lastTouch) > 1.5 else { return }
        let k = scale(relativeTo: nil).x, joints = hands.flatMap(\.joints)
        guard !joints.isEmpty else { return }
        for c in chapters {
            guard let station = model.findEntity(named: c.name) else { continue }
            let p = station.position(relativeTo: nil)
            if joints.contains(where: { j in simd_distance(V2(j.x, j.z), V2(p.x, p.z)) < Self.padRadius*k && j.y > p.y - 0.02 && j.y < p.y + Self.touchAbove*max(1, k) }) {
                lastTouch = Date(); controller?.time = c.start
                Diag.mark("animation: chapter \(c.name)")
                return
            }
        }
    }

    /// The box it takes (space coordinates when it is in the space's root): for keeping answer text off it.
    func keepClear(scale k: Float) -> InfoTarget {
        let s = Self.size*k
        return InfoTarget(id: "animation", key: animationID, center: position + V3(0, s.y/2, 0), size: s, yaw: yawOf(orientation.act(V3(0, 0, 1))), label: animationID)
    }
}
