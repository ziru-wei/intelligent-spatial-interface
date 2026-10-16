import RealityKit
import UIKit
import simd

/// Rain or snow, ported from the web editor (src/weather-scene.mjs createPrecipitation): ballistic drops under world gravity, each
/// column cast once against the room (the headset's mesh: `collide`) so it lands on what is really below, its impact (rain: a ring
/// spreading on the surface and droplets splashing up; snow: a flake settling) drawn right there when it lands. Every column runs on
/// its own cycle (fall, then the impact's life) from its own phase, so drops come continuously, never in waves; everything follows
/// from the time alone.
///   count    55 from a ceiling, 45 else, + 55 × intensity
///   start    over 78% of the patch: from a ceiling 6 cm below it; over a lying patch 55 cm above it; in front of an upright one
///            (14–29 cm out) at 27–35% of its height above its centre
///   motion   rain 1.15 m/s down plus 3.8 m/s²; snow 0.16 m/s plus 0.055 m/s², swaying
///   cycle    the fall, then 0.65 s (rain) or 2.6 s (snow) for the impact
/// Drawn as camera-facing quads in one dynamic mesh per kind (LowLevelMesh), in space coordinates (this entity sits at the space's
/// origin); rain streaks stand upright, turned toward the viewer.
@MainActor
final class Precipitation: Entity {
    struct Column { var start: V3; var hit: V3?; var normal: V3; var flight: Float; var cycle: Float; var phase: Float; var size: Float }
    private var columns: [Column] = []
    private var snow = false
    private var v0: Float = 0, g: Float = 0
    private var drops: QuadBatch?, contacts: QuadBatch?, splashes: QuadBatch?

    required init() { super.init() }

    /// target: in space coordinates; collide(start) → where a drop from there lands (space), its surface normal, the distance.
    convenience init(target: WeatherTarget, snow: Bool, intensity: Float, seed: Int, collide: (V3) -> (point: V3, normal: V3, distance: Float)?) {
        self.init()
        self.snow = snow
        let ceiling = target.kind == "ceiling", lying = target.horizontal && !ceiling
        // From a ceiling, around where the gaze met it (a ceiling is a whole room: spread over it, drops would be too few to see),
        // denser.
        let count = Int(((ceiling ? 120 : 45) + intensity*(ceiling ? 90 : 55)).rounded())
        let focus = ceiling ? target.focus.map { V2(simd_dot($0 - target.center, target.right), simd_dot($0 - target.center, target.up)) } : nil
        let spanX = ceiling ? min(target.width*0.78, 2.4) : target.width*0.78, spanY = ceiling ? min(target.height*0.78, 2.4) : target.height*0.78
        v0 = snow ? 0.16 : 1.15; g = snow ? 0.055 : 3.8
        for i in 0..<count {
            var x: Float = 0, y: Float = 0
            for k in 0..<100 {
                x = (Self.random(i*7 + k*199 + seed) - 0.5)*spanX + (focus?.x ?? 0); y = (Self.random(i*11 + k*997 + seed) - 0.5)*spanY + (focus?.y ?? 0)
                if target.whole ? target.surface.contains(target.center + target.right*x + target.up*y) : true { break }
            }
            var local = V3(x, y, ceiling ? 0.06 : lying ? 0.55 : 0.14 + Self.random(i + 7)*0.15)
            if !lying && !ceiling { local.y = target.height*(0.27 + 0.08*Self.random(i + 5)) }
            let start = target.frame.point(local)
            let hit = collide(start), distance = hit?.distance ?? 3
            let flight = (sqrt(v0*v0 + 2*g*distance) - v0)/g
            columns.append(Column(start: start, hit: hit?.point, normal: hit?.normal ?? worldUp, flight: flight, cycle: flight + (snow ? 2.6 : 0.65),
                                  phase: Self.random(i*29 + seed), size: Self.random(i + 31)*0.6 + 0.65))
        }
        drops = QuadBatch(capacity: count, texture: snow ? Self.dotTexture : Self.streakTexture, opacity: snow ? 0.92 : 0.68)
        contacts = QuadBatch(capacity: count, texture: snow ? Self.flakeTexture : Self.ringTexture, opacity: 0.7)
        if !snow { splashes = QuadBatch(capacity: count*3, texture: Self.dotTexture, opacity: 0.7) }
        for b in [drops, contacts, splashes].compactMap({ $0 }) { addChild(b.entity) }
    }

    /// Moves everything to `time` (seconds since the weather started); `eye` (space) for turning the quads to the viewer.
    func update(time t: Float, eye: V3) {
        drops?.begin(); contacts?.begin(); splashes?.begin()
        for (i, c) in columns.enumerated() {
            let age = (t + c.phase*c.cycle).truncatingRemainder(dividingBy: c.cycle), fall = min(age, c.flight)
            var pos = c.start; pos.y -= v0*fall + 0.5*g*fall*fall
            if snow { pos.x += sin(fall*2 + Float(i))*0.035*sin(.pi*fall/c.flight) }
            if age < c.flight {
                if snow { drops?.facing(pos, size: V2(repeating: 0.009*c.size), eye: eye) }
                else { drops?.upright(pos, size: V2(0.0024*c.size, 0.055), eye: eye) }
            }
            guard let hit = c.hit, age >= c.flight else { continue }
            let impact = age - c.flight, p = hit + c.normal*0.004
            if snow {
                let s = 0.02*c.size*min(1, impact*4 + 0.2)
                contacts?.lying(p, normal: c.normal, size: s)
            } else {
                let life = min(1, impact/0.65), r = (0.008 + life*0.085)*(1 - life)
                if r > 0.001 { contacts?.lying(p, normal: c.normal, size: r*2) }
                if impact < 0.22 {
                    for j in 0..<3 {
                        let a = Float(i)*2.4 + Float(j)*2.094, u = impact
                        let splash = hit + V3(cos(a)*u*0.16, max(0, 0.42*u - 1.8*u*u), sin(a)*u*0.16)
                        splashes?.facing(splash, size: V2(repeating: 0.012*(1 - u/0.22)), eye: eye)
                    }
                }
            }
        }
        drops?.end(); contacts?.end(); splashes?.end()
    }

    static func random(_ i: Int) -> Float { let x = sin(Float(i)*127.1 + 311.7)*43758.5453; return x - floor(x) }

    // The sprites: a soft streak (rain), a soft dot (snowflakes, splash droplets), a thin bright ring (rain's impact), a soft disc (a
    // settled flake). White: the material tints them.
    static let streakTexture = sprite { x, y in max(0, 1 - abs(x)*2.2)*min(1, (1 - abs(y))*3) }
    static let dotTexture = sprite { x, y in max(0, 1 - (x*x + y*y).squareRoot()*1.15) }
    static let ringTexture = sprite { x, y in let r = (x*x + y*y).squareRoot(); return exp(-pow((r - 0.8)/0.08, 2)) }
    static let flakeTexture = sprite { x, y in let r = (x*x + y*y).squareRoot(); return max(0, 1 - r)*0.9 }
    static func sprite(_ alpha: (Float, Float) -> Float) -> TextureResource? {
        let n = 64
        var px = [UInt8](repeating: 0, count: n*n*4)
        for j in 0..<n { for i in 0..<n {
            let a = min(1, max(0, alpha((Float(i) + 0.5)/Float(n)*2 - 1, (Float(j) + 0.5)/Float(n)*2 - 1)))
            let v = UInt8(a*255); px[(j*n + i)*4] = v; px[(j*n + i)*4 + 1] = v; px[(j*n + i)*4 + 2] = v; px[(j*n + i)*4 + 3] = v
        } }
        guard let ctx = CGContext(data: &px, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n*4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue), let img = ctx.makeImage() else { return nil }
        return try? TextureResource(image: img, options: .init(semantic: .color))
    }
}

/// Quads rebuilt every frame in one dynamic mesh (LowLevelMesh): position + uv, two triangles each.
@MainActor
final class QuadBatch {
    let entity = ModelEntity()
    private let mesh: LowLevelMesh
    private let capacity: Int
    private var vertices: [Float] = [], count = 0

    init?(capacity: Int, texture: TextureResource?, opacity: Float) {
        self.capacity = capacity
        var d = LowLevelMesh.Descriptor()
        d.vertexAttributes = [.init(semantic: .position, format: .float3, offset: 0), .init(semantic: .uv0, format: .float2, offset: 12)]
        d.vertexLayouts = [.init(bufferIndex: 0, bufferStride: 20)]
        d.vertexCapacity = capacity*4; d.indexCapacity = capacity*6; d.indexType = .uint32
        guard let m = try? LowLevelMesh(descriptor: d) else { return nil }
        mesh = m
        m.withUnsafeMutableIndices { raw in
            let idx = raw.bindMemory(to: UInt32.self)
            for q in 0..<capacity { let b = UInt32(q*4); for (k, v) in [b, b + 1, b + 2, b, b + 2, b + 3].enumerated() { idx[q*6 + k] = v } }
        }
        guard let resource = try? MeshResource(from: m) else { return nil }
        var mat = UnlitMaterial(color: .white)
        if let texture { mat.color = .init(tint: .white, texture: .init(texture)) }
        mat.blending = .transparent(opacity: .init(floatLiteral: opacity)); mat.writesDepth = false
        entity.model = ModelComponent(mesh: resource, materials: [mat])
    }

    func begin() { vertices.removeAll(keepingCapacity: true); count = 0 }
    private func quad(_ c: V3, _ a: V3, _ b: V3) {
        guard count < capacity else { return }
        for (p, u) in [(c - a - b, V2(0, 1)), (c + a - b, V2(1, 1)), (c + a + b, V2(1, 0)), (c - a + b, V2(0, 0))] { vertices += [p.x, p.y, p.z, u.x, u.y] }
        count += 1
    }
    /// Facing the eye.
    func facing(_ c: V3, size: V2, eye: V3) {
        let n = (eye - c).normalized, r = simd_cross(worldUp, n).normalized, u = simd_cross(n, r)
        quad(c, r*size.x/2, u*size.y/2)
    }
    /// Upright (its long side vertical), turned about the vertical toward the eye.
    func upright(_ c: V3, size: V2, eye: V3) {
        var n = eye - c; n.y = 0; n = n.length > 1e-4 ? n.normalized : V3(0, 0, 1)
        quad(c, simd_cross(worldUp, n).normalized*size.x/2, worldUp*size.y/2)
    }
    /// Lying on a surface with this normal.
    func lying(_ c: V3, normal: V3, size: Float) {
        let t = abs(normal.y) < 0.9 ? simd_cross(worldUp, normal).normalized : V3(1, 0, 0), b = simd_cross(normal, t)
        quad(c, t*size/2, b*size/2)
    }
    func end() {
        let n = count
        mesh.withUnsafeMutableBytes(bufferIndex: 0) { raw in
            vertices.withUnsafeBytes { src in raw.copyMemory(from: UnsafeRawBufferPointer(rebasing: src[0..<min(src.count, raw.count)])) }
        }
        mesh.parts.replaceAll([LowLevelMesh.Part(indexOffset: 0, indexCount: n*6, topology: .triangle, materialIndex: 0,
                                                 bounds: BoundingBox(min: V3(repeating: -100), max: V3(repeating: 100)))])
    }
}
