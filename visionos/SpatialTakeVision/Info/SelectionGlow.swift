import RealityKit
import UIKit
import simd

/// The thing the user means now (InfoSelection's selection, a box), glowing: a faint light blue shell just outside the box, no edges,
/// breathing (brighter and fainter every BREATH seconds), seen through whatever is in front of it (only the hands cover it). Fades in on
/// a new selection and out when there is none. Space coordinates.
@MainActor
final class SelectionGlow: Entity {
    static let breath: Float = 2.4, margin: Float = 0.025
    static let color = UIColor(red: 0.62, green: 0.84, blue: 1, alpha: 1), alpha: Float = 0.16
    private(set) var target: InfoTarget?
    private var level: Float = 0        // 0 → 1 as it fades in
    private var shown = Entity()

    required init() {
        super.init()
        components.set(OpacityComponent(opacity: 0))
        addChild(shown)
    }

    /// The selection now (nil: none, or a zone).
    func show(_ selected: InfoTarget?) {
        let t = selected?.size == .zero ? nil : selected
        guard t != target else { return }
        target = t
        guard let t else { return }   // the old shell stays while it fades out
        shown.removeFromParent(); shown = Self.make(t); addChild(shown); level = 0
    }

    /// Each frame: fade toward shown or hidden, and breathe.
    func update(time: Float, dt: Float) {
        level = target == nil ? max(0, level - dt*3) : min(1, level + dt*3)
        let breath = 0.65 + 0.35*sin(time*2*Float.pi/Self.breath)
        components.set(OpacityComponent(opacity: level*breath))
        isEnabled = level > 0
    }

    private static func make(_ t: InfoTarget) -> Entity {
        let root = Entity()
        root.transform = Transform(matrix: InfoSelection.frame(t))
        var m = UnlitMaterial(color: color); m.blending = .transparent(opacity: .init(floatLiteral: alpha)); m.readsDepth = false; m.writesDepth = false
        let size = t.size + V3(repeating: margin*2)
        root.addChild(ModelEntity(mesh: .generateBox(size: size, cornerRadius: min(0.03, size.min()*0.45)), materials: [m]))
        return root
    }
}
