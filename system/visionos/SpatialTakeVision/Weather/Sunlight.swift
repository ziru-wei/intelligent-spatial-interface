import RealityKit
import UIKit
import simd

/// Sunlight on a clear or partly cloudy day, after the web editor (src/weather-art.mjs createSunlight): light coming in through the
/// patch (a window, a wall) or falling onto it (a desk, the floor), as a few soft shafts of warm light and, where it lands, a pool of
/// dappled leaf-light swaying (the ground kernel's dapple, drawn alone). Space coordinates (this entity sits at the space's origin).
///   upright  the light goes in along the patch's normal and down (0.85 × normal, 0.6 down): the pool is the patch's outline cast along
///            it onto the floor below (or what the room's mesh has there), the shafts run from the patch to the pool
///   lying    the light comes from above and a little aside: the dapple on the patch itself (WeatherEffect), and shafts down onto it
@MainActor
final class Sunlight: Entity {
    private var pool: (ShaderTexture, GroundParams)?
    private var shafts: [(entity: ModelEntity, from: V3, to: V3, width: Float)] = []
    required init() { super.init() }

    convenience init(target: WeatherTarget, floorY: Float?) {
        self.init()
        let lying = target.horizontal && target.kind != "ceiling"
        let w = target.width*0.9, h = target.height*0.86
        let dir = lying ? V3(0.25, -1, 0.2).normalized : (target.normal*0.85 + V3(0, -0.6, 0)).normalized
        // Where light through a point lands: on the floor's plane (the zone's, from the layout).
        func land(_ p: V3) -> V3? {
            guard let floorY, dir.y < -0.05 else { return nil }
            let t = (floorY + 0.012 - p.y)/dir.y
            return t > 0 ? p + dir*t : nil
        }
        if !lying {
            let corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)].map { (sx: Float, sy: Float) in target.center + target.right*(sx*w/2) + target.up*(sy*h/2) + target.normal*0.03 }
            let landed = corners.compactMap(land)
            if landed.count == 4, let tex = ShaderTexture(kernel: "weatherGround", width: 384, height: 384) {
                // The pool: the patch cast onto the floor, as a quad (uv over the patch).
                var d = MeshDescriptor(name: "sun-pool")
                d.positions = MeshBuffers.Positions(landed); d.textureCoordinates = MeshBuffers.TextureCoordinates([V2(0, 1), V2(1, 1), V2(1, 0), V2(0, 0)])
                let up = simd_cross(landed[1] - landed[0], landed[3] - landed[0]).y > 0
                d.primitives = .triangles(up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2])
                var p = GroundParams(); p.horizontal = 1; p.sunny = 1; p.opacity = 0; p.patchSize = SIMD2(simd_distance(landed[0], landed[1]), simd_distance(landed[0], landed[3]))
                p.low = SIMD4(1, 0.85, 0.6, 1); p.high = SIMD4(1, 0.95, 0.8, 1)
                tex.draw(p)
                if let mesh = try? MeshResource.generate(from: [d]) {
                    let e = ModelEntity(mesh: mesh, materials: [tex.material()]); e.components.set(ModelSortGroupComponent(group: WeatherEffect.sortGroup, order: 1)); addChild(e)
                    pool = (tex, p)
                }
                // Shafts from the patch to the pool: a few, across the patch.
                for (k, (sx, sy)) in [(-0.25, 0.2), (0.15, -0.1), (0.35, 0.3), (-0.05, -0.3)].enumerated() as EnumeratedSequence<[(Float, Float)]> {
                    let from = target.center + target.right*(sx*w) + target.up*(sy*h) + target.normal*0.03
                    guard let to = land(from) else { continue }
                    addShaft(from: from, to: to, width: 0.12 + 0.06*Float(k % 2))
                }
            }
        } else {
            // Onto a lying patch: shafts from above, slanted, ending on it.
            for (sx, sy) in [(-0.2, 0.1), (0.2, -0.15), (0.05, 0.25)] as [(Float, Float)] {
                let to = target.center + target.right*(sx*w) + target.up*(sy*h)
                addShaft(from: to - dir*1.35, to: to, width: 0.1)
            }
        }
    }

    static let shaftTexture: TextureResource? = {
        // Soft across (a Gaussian), fading toward both ends; white (the material tints it warm).
        let n = 64
        var px = [UInt8](repeating: 0, count: n*n*4)
        for j in 0..<n { for i in 0..<n {
            let x = (Float(i) + 0.5)/Float(n)*2 - 1, y = (Float(j) + 0.5)/Float(n)
            let a = exp(-x*x*4)*min(1, y*4)*min(1, (1 - y)*2.5)
            let v = UInt8(min(255, a*255)); px[(j*n + i)*4] = v; px[(j*n + i)*4 + 1] = v; px[(j*n + i)*4 + 2] = v; px[(j*n + i)*4 + 3] = v
        } }
        guard let ctx = CGContext(data: &px, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n*4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue), let img = ctx.makeImage() else { return nil }
        return try? TextureResource(image: img, options: .init(semantic: .color))
    }()

    private func addShaft(from: V3, to: V3, width: Float) {
        var m = UnlitMaterial(color: UIColor(red: 1, green: 0.89, blue: 0.63, alpha: 1))
        if let t = Self.shaftTexture { m.color = .init(tint: UIColor(red: 1, green: 0.89, blue: 0.63, alpha: 1), texture: .init(t)) }
        m.blending = .transparent(opacity: .init(floatLiteral: 0.22)); m.writesDepth = false
        let e = ModelEntity(mesh: .generatePlane(width: 1, height: 1), materials: [m])
        e.components.set(ModelSortGroupComponent(group: WeatherEffect.sortGroup, order: 2))
        addChild(e); shafts.append((e, from, to, width))
    }

    /// The pool's dapple sways; each shaft turns about its own axis to face the viewer.
    func update(time t: Float, eye: V3) {
        if case (let tex, var p)? = pool { p.time = t; tex.draw(p); pool = (tex, p) }
        for s in shafts {
            let axis = s.to - s.from, len = axis.length, y = axis/len, mid = (s.from + s.to)/2
            var x = simd_cross(y, (eye - mid).normalized); if x.length < 1e-4 { x = V3(1, 0, 0) }; x = x.normalized
            let z = simd_cross(x, y)
            s.entity.transform = Transform(matrix: simd_float4x4(right: x*s.width, up: y*len, normal: z, origin: mid))
        }
    }
}
