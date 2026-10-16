import RealityKit
import SwiftUI
import UIKit
import simd

/// The FindMy mod's answer (editor/scripts/findmy.py resolve: the item and the layout box holding it), after the web editor
/// (src/findmy.mjs): the container highlighted in fluorescent green, a faint fill and a bright outline, seen through whatever is in front of it (only
/// the hands cover it); while it
/// is out of view, an arrow at the edge of the view points toward it (behind the user too). Optionally it goes once a hand comes within
/// `approach` metres of the container (src/findmy-approach.mjs), and stays gone.
struct FindMyData: Decodable, Equatable {
    struct Box: Decodable, Equatable { let id: String; let label: String?; let center: [Double]; let size: [Double]; let yaw: Double? }
    /// The box holding it; a nested one (a shelf of a bookcase) with its parent.
    struct Target: Decodable, Equatable { let id: String; let label: String?; let center: [Double]; let size: [Double]; let yaw: Double?; let parent: Box? }
    let status: String
    let item_id: String?
    let label: String?
    let target: Target?
}

@MainActor
final class FindMyEffect: Entity {
    static let tint = UIColor(red: 0x39/255, green: 0xff/255, blue: 0x14/255, alpha: 1)   // fluorescent green
    let box: InfoTarget
    private let highlight = Entity(), parentHighlight = Entity(), arrow = ModelEntity()

    /// A box's twelve edges as thin bars (its own frame).
    static func edges(_ size: V3, width w: Float, material: UnlitMaterial, into parent: Entity) {
        let h = size/2
        for axis in 0..<3 {
            let o = (axis + 1) % 3, p = (axis + 2) % 3
            for s1: Float in [-1, 1] { for s2: Float in [-1, 1] {
                var sz = V3(repeating: w); sz[axis] = size[axis] + w
                var at = V3.zero; at[o] = s1*h[o]; at[p] = s2*h[p]
                let bar = ModelEntity(mesh: .generateBox(size: sz), materials: [material]); bar.position = at; parent.addChild(bar)
            } }
        }
    }
    private(set) var removed = false
    /// Removal waits until the hands have been away from it once (a hand already by the container when it shows does not count).
    private var handsAway = false

    required init() { box = InfoTarget(id: "", key: "", center: .zero, size: .zero, yaw: 0, label: nil); super.init() }

    init(_ t: FindMyData.Target) {
        box = InfoTarget(id: "layout:" + t.id, key: "", center: V3(t.center), size: V3(t.size), yaw: radians(Float(t.yaw ?? 0)), label: t.label)
        super.init()
        func mat(_ o: Float) -> UnlitMaterial { var m = UnlitMaterial(color: Self.tint); m.blending = .transparent(opacity: .init(floatLiteral: o)); m.readsDepth = false; m.writesDepth = false; return m }
        // A nested target's parent, faintly around it (a fill and its edges, both light).
        if let p = t.parent {
            let pb = InfoTarget(id: "layout:" + p.id, key: "", center: V3(p.center), size: V3(p.size), yaw: radians(Float(p.yaw ?? 0)), label: p.label)
            parentHighlight.transform = Transform(matrix: InfoSelection.frame(pb))
            parentHighlight.addChild(ModelEntity(mesh: .generateBox(size: pb.size*1.01), materials: [mat(0.04)]))
            Self.edges(pb.size*1.01, width: 0.005, material: mat(0.3), into: parentHighlight)
            addChild(parentHighlight)
        }
        highlight.transform = Transform(matrix: InfoSelection.frame(box))
        highlight.addChild(ModelEntity(mesh: .generateBox(size: box.size), materials: [mat(0.13)]))
        // The outline: the box's twelve edges as thin bars.
        let h = box.size/2, w: Float = 0.008
        for axis in 0..<3 {
            let o = (axis + 1) % 3, p = (axis + 2) % 3
            for s1: Float in [-1, 1] { for s2: Float in [-1, 1] {
                var size = V3(repeating: w); size[axis] = box.size[axis] + w
                var at = V3.zero; at[o] = s1*h[o]; at[p] = s2*h[p]
                let bar = ModelEntity(mesh: .generateBox(size: size), materials: [mat(0.95)]); bar.position = at; highlight.addChild(bar)
            } }
        }
        addChild(highlight)
        // The guidance arrow: a flat arrowhead with a short tail, in the view's plane.
        let path = UIBezierPath(); path.move(to: CGPoint(x: 0.075, y: 0)); path.addLine(to: CGPoint(x: -0.025, y: 0.052)); path.addLine(to: CGPoint(x: -0.025, y: 0.019))
        path.addLine(to: CGPoint(x: -0.085, y: 0.019)); path.addLine(to: CGPoint(x: -0.085, y: -0.019)); path.addLine(to: CGPoint(x: -0.025, y: -0.019)); path.addLine(to: CGPoint(x: -0.025, y: -0.052)); path.close()
        if let shape = try? MeshResource(extruding: Path(path.cgPath), extrusionOptions: .init()) { arrow.model = ModelComponent(mesh: shape, materials: [mat(1)]) }
        arrow.isEnabled = false
        addChild(arrow)
    }

    /// Each frame: the guidance while the box is out of view; the removal when a hand is near. Space coordinates.
    func update(head: HeadPose, hands: [WorldSensing.Hand], removeOnApproach: Bool, approach: Float) {
        let near = hands.flatMap(\.joints).contains(where: { InfoSelection.surfaceDistance($0, box) <= approach })
        if !near, hands.flatMap(\.joints).allSatisfy({ InfoSelection.surfaceDistance($0, box) > approach + 0.15 }) { handsAway = true }
        if !removed, removeOnApproach, handsAway, near {
            Diag.mark("findmy: removed (a hand came to it)")
            removed = true; highlight.isEnabled = false; parentHighlight.isEnabled = false; arrow.isEnabled = false
        }
        guard !removed else { return }
        let corners = InfoSelection.boxPoints(box)
        let inView = corners.contains { p in TextPlacement.viewAngles(p, head: head).map { abs($0.x) < 30 && abs($0.y) < 24 } ?? false }
        arrow.isEnabled = !inView
        guard !inView else { return }
        // Toward the box in the view's plane (its direction in head space; behind: the side it is on), at the edge of the view.
        let d = box.center - head.eye
        var v = V2(simd_dot(d, head.right), simd_dot(d, head.up))
        if v.length < 1e-4 { v = V2(1, 0) }
        v = v.normalized
        let k = 0.82/max(abs(v.x)/0.42, abs(v.y)/0.32), dist: Float = 0.9
        let at = head.eye + head.forward*dist + (head.right*v.x + head.up*v.y)*(k*dist*0.5)
        let angle = atan2(v.y, v.x)
        let x = head.right*cos(angle) + head.up*sin(angle), y = simd_cross(-head.forward, x)
        arrow.transform = Transform(matrix: simd_float4x4(right: x, up: y, normal: -head.forward, origin: at)*simd_float4x4(SIMD4(0.6, 0, 0, 0), SIMD4(0, 0.6, 0, 0), SIMD4(0, 0, 0.001, 0), SIMD4(0, 0, 0, 1)))
    }
}
