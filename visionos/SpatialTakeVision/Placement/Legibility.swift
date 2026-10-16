import Foundation
import simd

// Text colour and backing for answer text, ported from the web editor (src/legibility.mjs pickStyle). There the background is the
// camera frame behind the text; the headset gives the app no camera image, so the background is what the scan saw on that surface
// (ColorGrid: the baked colours under the text's rectangle), and clutter is the scan's local contrast there (src/surface-quality.mjs).
//
// Contrast is OKLab lightness first. Over background lightnesses with 10th / 90th percentiles q10 / q90, the text's lightness is
// solved for exactly enough contrast (q90 + need, or q10 − need, need growing with clutter), hue opposite the background's mean,
// chroma at most the background's median (never more colourful than the surroundings). When neither side has room on a busy
// background (a clean one never gets one: the side with more room instead; nor one nothing is known of), a backing ("glass":
// on the headset a tinted panel, as there is no camera image to blur) of the background's own hue is mixed in until one does.

struct TextStyle {
    var text: SIMD3<Float>        // linear RGB 0…1
    var side: String              // "light" | "dark"
    var glass: (tint: SIMD3<Float>, mix: Float)?
    var clutter: Float
    static let plain = TextStyle(text: SIMD3(1, 1, 1), side: "light", glass: nil, clutter: 0)
}

enum Legibility {
    static let cleanEnough: Float = 0.05   // style clutter (0 … ~0.3) under which no backing is ever added
    static let need: Float = 0.36, clutterWeight: Float = 1.6, glassClutter: Float = 0.25, Lmin: Float = 0.12, Lmax: Float = 0.97, maxC: Float = 0.07, percentile: Float = 0.1

    static func toLin(_ c: Float) -> Float { c <= 0.04045 ? c/12.92 : pow((c+0.055)/1.055, 2.4) }
    static func toSrgb(_ c: Float) -> Float { c <= 0.0031308 ? 12.92*c : 1.055*pow(c, 1/2.4) - 0.055 }
    static func linToOklab(_ c: SIMD3<Float>) -> SIMD3<Float> {
        let l = cbrt(0.4122214708*c.x + 0.5363325363*c.y + 0.0514459929*c.z), m = cbrt(0.2119034982*c.x + 0.6806995451*c.y + 0.1073969566*c.z), s = cbrt(0.0883024619*c.x + 0.2817188376*c.y + 0.6299787005*c.z)
        return SIMD3(0.2104542553*l + 0.793617785*m - 0.0040720468*s, 1.9779984951*l - 2.428592205*m + 0.4505937099*s, 0.0259040371*l + 0.7827717662*m - 0.808675766*s)
    }
    static func oklabToLinRaw(_ p: SIMD3<Float>) -> SIMD3<Float> {
        let l = pow(p.x + 0.3963377774*p.y + 0.2158037573*p.z, 3), m = pow(p.x - 0.1055613458*p.y - 0.0638541728*p.z, 3), s = pow(p.x - 0.0894841775*p.y - 1.291485548*p.z, 3)
        return SIMD3(4.0767416621*l - 3.3077115913*m + 0.2309699292*s, -1.2684380046*l + 2.6097574011*m - 0.3413193965*s, -0.0041960863*l - 0.7034186147*m + 1.707614701*s)
    }
    static func oklabToLin(_ p: SIMD3<Float>) -> SIMD3<Float> { simd_clamp(oklabToLinRaw(p), SIMD3<Float>(repeating: 0), SIMD3<Float>(repeating: 1)) }
    static func inGamut(_ p: SIMD3<Float>) -> Bool { let c = oklabToLinRaw(p); return c.min() >= -1e-4 && c.max() <= 1 + 1e-4 }

    struct Stats { var q10: Float; var q90: Float; var mean: SIMD3<Float>; var medianC: Float }
    static func stats(_ lab: [SIMD3<Float>]) -> Stats {
        let L = lab.map(\.x).sorted(), C = lab.map { hypot($0.y, $0.z) }.sorted(), n = Float(lab.count)
        let q = { (v: [Float], f: Float) in v[min(v.count-1, max(0, Int(f*Float(v.count))))] }
        let mean = lab.reduce(SIMD3<Float>(repeating: 0), +)/n
        return Stats(q10: q(L, percentile), q90: q(L, 1-percentile), mean: mean, medianC: q(C, 0.5))
    }
    static func solveText(_ st: Stats, need: Float, preferred: String? = nil) -> (lab: SIMD3<Float>, side: String)? {
        let light = Lmax - (st.q90 + need), dark = (st.q10 - need) - Lmin
        let side = preferred ?? (light >= dark ? "light" : "dark")
        if (side == "light" ? light : dark) < 0 { return nil }
        let L = side == "light" ? st.q90 + need : st.q10 - need, ab = hypot(st.mean.y, st.mean.z)
        var C = min(maxC, st.medianC)
        let dir = ab > 1e-4 ? SIMD2(-st.mean.y/ab, -st.mean.z/ab) : SIMD2<Float>(0, 0)
        var k = 0
        while k < 8 && !inGamut(SIMD3(L, C*dir.x, C*dir.y)) { C /= 2; k += 1 }
        return (SIMD3(L, C*dir.x, C*dir.y), side)
    }

    /// The style for text over these background colours (sRGB bytes) with that clutter (0 plain … ~0.3 busy). No colours: white.
    static func pick(pixels: [SIMD3<UInt8>], clutter: Float) -> TextStyle {
        guard !pixels.isEmpty else { return TextStyle(text: SIMD3(1, 1, 1), side: "light", glass: nil, clutter: clutter) }   // nothing known: no backing
        let lin = pixels.map { SIMD3(toLin(Float($0.x)/255), toLin(Float($0.y)/255), toLin(Float($0.z)/255)) }
        let st = stats(lin.map(linToOklab)), need = Legibility.need + clutterWeight*clutter
        if let t = solveText(st, need: need) { return TextStyle(text: oklabToLin(t.lab), side: t.side, glass: nil, clutter: clutter) }
        // A clean background gets no backing even when its tone leaves less contrast than wanted: the side with more room, as far as it goes.
        if clutter < Self.cleanEnough {
            let light = Lmax - st.q90, dark = st.q10 - Lmin, side = light >= dark ? "light" : "dark"
            let L = side == "light" ? Lmax : Lmin
            return TextStyle(text: oklabToLin(SIMD3(L, 0, 0)), side: side, glass: nil, clutter: clutter)
        }
        // A backing: for each mix m and side, the tint lightness nearest the background's mean that leaves room (cost m + |Lt − mean|).
        let glassNeed = Legibility.need + clutterWeight*glassClutter*clutter
        var plan: (m: Float, Lt: Float, cost: Float)? = nil
        var m: Float = 0.3
        while m <= 0.951 {
            let lightMax = (Lmax - glassNeed - (1-m)*st.q90)/m, darkMin = (Lmin + glassNeed - (1-m)*st.q10)/m
            for Lt in [min(st.mean.x, lightMax), max(st.mean.x, darkMin)] where Lt >= 0.05 && Lt <= 0.98 {
                let cost = m + abs(Lt - st.mean.x)
                if plan == nil || cost < plan!.cost { plan = (m, Lt, cost) }
            }
            m += 0.025
        }
        let p = plan ?? (0.95, st.mean.x > 0.5 ? 0.9 : 0.15, 0)
        var mix = p.m
        while true {
            let tint = oklabToLin(SIMD3(p.Lt, st.mean.y*0.5, st.mean.z*0.5))
            let mixed = stats(lin.map { linToOklab($0*(1-mix) + tint*mix) })
            if let t = solveText(mixed, need: glassNeed) ?? (mix >= 0.98 ? solveText(mixed, need: 0) : nil) {
                return TextStyle(text: oklabToLin(t.lab), side: t.side, glass: (tint, mix), clutter: clutter)
            }
            mix = min(0.98, mix + 0.05)
        }
    }

    /// Clutter of a region from its cells' features: the mean of the busiest 60% (src/surface-quality.mjs), 0…1.
    static func clutter(_ features: [Float]) -> Float {
        guard !features.isEmpty else { return 0.3 }   // the scan saw nothing there: assume moderately busy
        let busy = features.sorted(by: >).prefix(Int(ceil(Double(features.count)*0.6)))
        return busy.reduce(0, +)/Float(busy.count)
    }
}
