import RealityKit
import UIKit
import simd

/// The layout drawn faintly over the room (space coordinates), to judge and fine-tune the alignment: walls as thin translucent slabs,
/// furniture and openings as translucent boxes. The zone the user picked is brighter.
enum LayoutOverlay {
    @MainActor
    static func make(_ sem: Semantic, zone: String?) -> Entity {
        let root = Entity()
        let wallMat = UnlitMaterial(color: UIColor(red: 0.3, green: 0.85, blue: 1, alpha: 1)), dimWall = UnlitMaterial(color: UIColor(white: 0.8, alpha: 1))
        let boxMat = UnlitMaterial(color: UIColor(red: 1, green: 0.65, blue: 0.2, alpha: 1)), doorMat = UnlitMaterial(color: UIColor(red: 0.5, green: 1, blue: 0.5, alpha: 1))
        func translucent(_ m: UnlitMaterial, _ a: Float) -> UnlitMaterial { var m = m; m.blending = .transparent(opacity: .init(floatLiteral: a)); return m }
        for w in sem.walls {
            let inZone = zone == nil || (w.rooms ?? []).contains(zone!)
            let e = ModelEntity(mesh: .generateBox(width: Float(w.size[0]), height: Float(w.size[1]), depth: max(0.02, Float(w.size[2]))),
                                materials: [translucent(inZone ? wallMat : dimWall, inZone ? 0.22 : 0.08)])
            e.transform = Transform(matrix: simd_float4x4(yaw: radians(Float(w.yaw ?? 0)), translation: V3(w.center)))
            root.addChild(e)
        }
        for o in sem.objects + sem.openings {
            guard let c = o.center, let s = o.size else { continue }
            let door = sem.openings.contains { $0.id == o.id }
            // A round one (a cylinder in the editor: the round table) as a cylinder, stretched to its size.
            let mesh: MeshResource = o.round ? .generateCylinder(height: 1, radius: 0.5) : .generateBox(size: 1)
            let e = ModelEntity(mesh: mesh, materials: [translucent(door ? doorMat : boxMat, zone == nil || o.room == zone ? 0.25 : 0.1)])
            e.transform = Transform(matrix: simd_float4x4(yaw: radians(Float(o.yaw ?? 0)), translation: V3(c)))
            e.scale = V3(max(0.02, Float(s[0])), max(0.02, Float(s[1])), max(0.02, Float(s[2])))
            root.addChild(e)
        }
        return root
    }
}
