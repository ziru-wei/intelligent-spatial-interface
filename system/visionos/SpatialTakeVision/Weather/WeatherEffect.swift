import RealityKit
import UIKit
import simd

/// One forecast entry's weather on a target (WeatherTarget): the web editor's storybook weather (src/weather-scene.mjs,
/// src/weather-art.mjs), its shaders ported to Metal (Weather.metalsrc, drawn each frame into textures: ShaderTexture).
///   ground    the sky's gradient on a whole window or ceiling (its own outline) or a feathered patch: a warm glow and bloom by day,
///             a moonlit rippling pool on a lying patch at night, a warm pool with dappled leaf-light on a lying patch by day, rain's
///             impact ripples, settling snow (weatherGround). Its opacity as on the web (none in fog, nor on a lying patch on a sunny day,
///             where the dappled light alone shows).
///   sun/moon  a disc with convection or a grainy lit face, and its halo, facing the viewer at the patch's upper left (weatherBody)
///   stars     twinkling points at night (not in fog)
///   clouds    ray-marched cloud volumes (weatherVolume, the web's lobed shape) drifting across the top, facing the viewer; partly cloudy
///             two, else four, greyer in rain and storm, dim at night
///   rain/snow particles falling with world gravity: onto a lying patch, from an upright patch's upper part (in front of it) or the
///             ceiling down to the floor; more with the entry's intensity. Their ripples or settling flakes are drawn where they land: on
///             the lying patch, else on a patch of the floor below
///   fog       ray-marched wisps spreading out into the room, facing the viewer
///   storm     rain, and a lightning flash every few seconds
/// Built in the target's frame (+z toward the viewer); a child of the space's root. update(time:) draws the textures and moves things.
@MainActor
final class WeatherEffect: Entity {
    private var ground: (ShaderTexture, GroundParams)?
    private var precipitation: Precipitation?
    private var body: (ShaderTexture, BodyParams)?
    private var volumes: [(entity: ModelEntity, texture: ShaderTexture, params: VolumeParams, base: V3, drift: V3, phase: Float)] = []
    private var storm = false, nextFlash: TimeInterval = 0, flashAt: TimeInterval = -10
    private var sunlight: Sunlight?
    private var start: TimeInterval = 0
    private var frame = 0
    private(set) var entryID = ""

    required init() { super.init() }

    /// collide(start) (space): where a drop falling from there lands, for rain and snow (Precipitation).
    convenience init(target: WeatherTarget, entry: WeatherData.Entry, floorY: Float?, collide: (V3) -> (point: V3, normal: V3, distance: Float)?) {
        self.init()
        entryID = entry.id
        transform = Transform(matrix: target.frame)
        start = Date.timeIntervalSinceReferenceDate
        let night = entry.isNight, c = entry.condition, intensity = Float(entry.intensity ?? 0.5)
        let wet = c == "rain" || c == "storm", snow = c == "snow", sunny = c == "clear" || c == "partly_cloudy", fog = c == "fog"
        let cloudy = ["partly_cloudy", "cloudy", "rain", "snow", "storm"].contains(c)
        // A ceiling lies flat too, but faces down: "lying" is a floor, a desk, a table (rain lands on it).
        let w = target.width, h = target.height, small = min(w, h), ceiling = target.kind == "ceiling", lying = target.horizontal && !ceiling

        // Ground.
        let palette: (UInt32, UInt32) = night ? (0x040a1c, 0x102746) : lying && sunny ? (0xd7a950, 0xfff0bb) : snow ? (0xa8bbc9, 0xd8e4eb) : wet ? (0x718eaa, 0xccd9df) : (0x8fbecf, 0xf1dfbd)
        let opacity: Float = fog || (lying && !night && sunny) ? 0 : target.whole ? (night ? 0.94 : 0.48) : lying ? (night ? 0.88 : 0.56) : (night ? 0.96 : 0.78)
        // Texels by size (about 300 per metre, up to 1024 a side): a whole ceiling is several metres across.
        let side = Float(min(1024, max(256, Int(max(w, h)*300)))), tw = Int(max(64, side*w/max(w, h))), th = Int(max(64, side*h/max(w, h)))
        if let tex = ShaderTexture(kernel: "weatherGround", width: tw, height: th), let mesh = target.whole ? Self.outlineMesh(target) : MeshResource.generatePlane(width: w, height: h) {
            var p = GroundParams()
            p.horizontal = lying ? 1 : 0; p.whole = target.whole ? 1 : 0; p.wet = wet ? 1 : 0; p.snow = snow ? 1 : 0
            p.night = night ? 1 : 0; p.sunny = sunny ? 1 : 0; p.ceiling = ceiling ? 1 : 0; p.opacity = opacity; p.intensity = intensity
            p.contacts = 0   // rain's ripples and settling snow are drawn where each drop lands (Precipitation)
            p.patchSize = SIMD2(w, h); p.low = Self.rgba(palette.0); p.high = Self.rgba(palette.1)
            tex.draw(p)
            // On an upright patch or the ceiling the sky stays whole: the room's mesh (often a few cm off the wall) must not eat into it.
            var material = tex.material(); if !lying { material.readsDepth = false }
            let e = ModelEntity(mesh: mesh, materials: [material]); e.position.z = 0.02
            e.components.set(ModelSortGroupComponent(group: Self.sortGroup, order: 0)); addChild(e)
            ground = (tex, p)
        }

        // Sun or moon, facing the viewer.
        if !lying && (sunny || night) && !fog, let tex = ShaderTexture(kernel: "weatherBody", width: 256, height: 256) {
            let r = min(0.09, small*0.08), size = r*2*1.6
            var p = BodyParams(); p.night = night ? 1 : 0; p.phase = Float.random(in: 0...6)
            tex.draw(p)
            let e = ModelEntity(mesh: .generatePlane(width: size, height: size), materials: [tex.material()])
            e.position = V3(-w*0.28, h*0.3, 0.22 + r); e.components.set(BillboardComponent()); e.components.set(ModelSortGroupComponent(group: Self.sortGroup, order: 1)); addChild(e)
            body = (tex, p)
        }
        // Stars.
        if night && !fog {
            var p = ParticleEmitterComponent()
            p.emitterShape = .box; p.emitterShapeSize = V3(w*0.9, h*0.9, 0.02); p.speed = 0
            p.mainEmitter.birthRate = min(60, max(8, w*h*14)); p.mainEmitter.lifeSpan = 2.5
            p.mainEmitter.size = min(0.006, small*0.003); p.mainEmitter.color = .constant(.single(Self.color(0xffe8ca)))
            p.mainEmitter.opacityCurve = .quickFadeInOut
            let stars = Entity(); stars.position.z = 0.05; stars.components.set(p); addChild(stars)
        }
        // Clouds: the web's lobed volumes, drifting.
        if cloudy {
            let count = c == "partly_cloudy" ? 2 : 4, tint = night ? 0x52617d : wet || c == "storm" ? 0x9aa6b4 : 0xffffff
            for i in 0..<count {
                let size = min(0.5, small*0.42)*(0.8 + 0.4*Self.random(i*7 + 3))
                let base = lying ? V3((Self.random(i*3) - 0.5)*w*0.7, (Self.random(i*5) - 0.5)*h*0.7, 0.45) : V3((Self.random(i*3) - 0.5)*w*0.8, h*(0.18 + 0.18*Self.random(i*5)), 0.25)
                var p = VolumeParams(); p.density = night ? 0.9 : 1.6; p.cloudShape = 1; p.cloudSeed = Float(i) + 0.37; p.tint = Self.rgba(UInt32(tint)); p.extent = V3(size, size*0.62, size*0.6)
                addVolume(p, size: V2(size, size*0.62), at: base, drift: V3(0.05, 0.01, 0), phase: Self.random(i*11)*6)
            }
        }
        // Rain or snow: the web's ballistic drops, landing on what is really below, their ripples or flakes there (Precipitation).
        if wet || snow {
            let p = Precipitation(target: target, snow: snow, intensity: intensity, seed: 1, collide: collide)
            p.transform = Transform(matrix: target.frame.inverse)   // its own coordinates are the space's
            addChild(p); precipitation = p
        }
        // Fog: wisps spreading out into the room.
        if fog {
            for i in 0..<6 {
                let size = 0.6 + 0.5*Self.random(i + 14)
                var p = VolumeParams(); p.density = night ? 0.55 : 0.4; p.cloudShape = 0; p.cloudSeed = Float(i)*1.7
                p.tint = Self.rgba(UInt32(night ? (i % 2 == 0 ? 0x52617d : 0x3e6575) : (i % 2 == 0 ? 0xd5d9ef : 0xc3e3e8))); p.extent = V3(size, size*0.4, size)
                let base = V3((Self.random(i + 44) - 0.5)*max(w, 1.2), (Self.random(i + 84) - 0.5)*h*0.5, 0.3 + Self.random(i + 64)*0.6)
                addVolume(p, size: V2(size, size*0.45), at: base, drift: V3(0.06, 0.02, 0.05), phase: Float(i))
            }
        }
        // Lightning: the ground lights up (update(time:)).
        storm = c == "storm"
        // Sunlight by day: shafts and a dappled pool where it lands.
        if sunny && !night && !ceiling {
            let s = Sunlight(target: target, floorY: floorY)
            s.transform = Transform(matrix: target.frame.inverse)   // its own coordinates are the space's
            addChild(s); sunlight = s
        }
    }

    private func addVolume(_ p: VolumeParams, size: V2, at base: V3, drift: V3, phase: Float) {
        guard let tex = ShaderTexture(kernel: "weatherVolume", width: 192, height: Int(192*size.y/size.x)) else { return }
        tex.draw(p)
        let e = ModelEntity(mesh: .generatePlane(width: size.x, height: size.y), materials: [tex.material()])
        e.position = base; e.components.set(BillboardComponent()); e.components.set(ModelSortGroupComponent(group: Self.sortGroup, order: 2)); addChild(e)
        volumes.append((e, tex, p, base, drift, phase))
    }

    /// Draws the textures (the ground every frame, the volumes every other), moves the clouds and wisps and the rain or snow. `time`:
    /// seconds; `eye`: the viewer (space), for turning drops toward it.
    func update(time: TimeInterval, eye: V3) {
        let t = Float(time - start)
        frame += 1
        if storm {   // a flash every 4–7 s: bright, a flicker, then fading
            if time >= nextFlash { flashAt = time; nextFlash = time + 4 + Double.random(in: 0...3) }
            let a = time - flashAt
            ground?.1.flash = Float(a < 0.08 ? 1 : a < 0.15 ? 0.3 : a < 0.22 ? 0.85 : max(0, exp(-(a - 0.22)*8)*0.85))
        }
        if case (let tex, var p)? = ground { p.time = t; tex.draw(p); ground = (tex, p) }
        precipitation?.update(time: t, eye: eye)
        sunlight?.update(time: t, eye: eye)
        if case (let tex, var p)? = body, frame % 3 == 0 { p.time = t; tex.draw(p); body = (tex, p) }
        for i in volumes.indices {
            var v = volumes[i]
            v.entity.position = v.base + V3(sin(t*0.12 + v.phase)*v.drift.x*4, sin(t*0.25 + v.phase)*v.drift.y*3, sin(t*0.15 + v.phase)*v.drift.z*4)
            if frame % 2 == i % 2 { v.params.time = t; v.texture.draw(v.params) }
            volumes[i] = v
        }
    }

    // MARK: Helpers

    /// See-through layers drawn in a fixed order (the ground, then the sun or moon, then clouds and fog), none hiding another: no
    /// depth writes (ShaderTexture.material), so a cloud never cuts a hole in the sky behind it.
    static let sortGroup = ModelSortGroup(depthPass: nil)

    static func color(_ v: UInt32, _ a: CGFloat = 1) -> UIColor {
        UIColor(red: CGFloat((v >> 16) & 255)/255, green: CGFloat((v >> 8) & 255)/255, blue: CGFloat(v & 255)/255, alpha: a)
    }
    /// A colour for the kernels: linear RGB (they write it as is; the web's colours are sRGB).
    static func rgba(_ v: UInt32) -> SIMD4<Float> {
        let c = [Float((v >> 16) & 255), Float((v >> 8) & 255), Float(v & 255)].map { Legibility.toLin($0/255) }
        return SIMD4(c[0], c[1], c[2], 1)
    }
    static func random(_ i: Int) -> Float { let x = sin(Float(i)*127.1 + 311.7)*43758.5453; return x - floor(x) }

    /// A whole window or ceiling by its own outline (its triangles), in the target's frame, with UVs over its rectangle.
    static func outlineMesh(_ t: WeatherTarget) -> MeshResource? {
        let s = t.surface
        var positions: [SIMD3<Float>] = [], uvs: [SIMD2<Float>] = [], indices: [UInt32] = []
        for (a, b, c) in s.triangles {
            var tri = [a, b, c].map { l -> SIMD3<Float> in let p = s.point(l) - t.center; return V3(simd_dot(p, t.right), simd_dot(p, t.up), 0) }
            if simd_cross(tri[1] - tri[0], tri[2] - tri[0]).z < 0 { tri.swapAt(1, 2) }   // facing +z (the viewer)
            for p in tri { indices.append(UInt32(positions.count)); positions.append(p); uvs.append(V2(p.x/t.width + 0.5, p.y/t.height + 0.5)) }
        }
        guard !positions.isEmpty else { return nil }
        var d = MeshDescriptor(name: "weather-outline")
        d.positions = MeshBuffers.Positions(positions); d.textureCoordinates = MeshBuffers.TextureCoordinates(uvs); d.primitives = .triangles(indices)
        return try? MeshResource.generate(from: [d])
    }
}
