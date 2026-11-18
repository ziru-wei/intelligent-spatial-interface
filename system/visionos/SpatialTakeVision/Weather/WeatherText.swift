import Foundation
import simd

/// Where the weather's text answer goes, by where the weather shows (WeatherTarget), in the info answer's hand lettering:
///   window   on the wall under the window: the surface search on upright surfaces near the middle of its sill, never above it
///   table    on the table, always: the surface search on that table only (anywhere in front), off the patch; else straight onto its
///            clearest free spot nearest the user (onTable). Never floating. It turns smoothly to read toward the user as they move
///            (AppModel: AnswerEntity.turnToward).
///   wall     beside the patch: the info answer's placement with the patch as its box, on upright surfaces only
///   ceiling  on the wall the person faces squarely (of the walls met across ±30° of the levelled gaze, the one most square on, within
///            35°), right below where it meets the ceiling, across from the person: set there directly (looking up, that edge may be
///            out of the comfortable view; it is where the text belongs), as wide as reads at that distance, inside the wall. No such
///            wall: floating ahead.
/// Never on a side: upright, the text faces the eye within 50° where it sits (MIN_FACING).
/// Each falls back to the info answer's placement around the weather (upright surfaces), then to floating. The weather takes much of
/// the view, so its text may sit in a wider field (FIELD × the comfortable one, OVERFLOW of it past that).
/// (An upright surface for text here: a wall's or a box's side, not a window or an opening's frame.)
enum WeatherText {
    static let sill: Float = 0.12, underCeiling: Float = 0.06, field: Float = 1.4, overflow: Float = 0.4, minFacing = cos(radians(50))

    /// The weather's patch as an info box: its centre, its size along its own axes (2 cm thick), its yaw (InfoTarget: about +y).
    static func box(_ t: WeatherTarget) -> InfoTarget {
        if t.horizontal {   // lying: width along right, height along the horizontal `up`
            return InfoTarget(id: "weather", key: "weather", center: t.center, size: V3(t.width, 0.02, t.height), yaw: atan2(-t.right.z, t.right.x), label: "weather")
        }
        return InfoTarget(id: "weather", key: "weather", center: t.center, size: V3(t.width, t.height, 0.02), yaw: atan2(t.normal.x, t.normal.z), label: "weather")
    }

    static func upright(_ s: Surface) -> Bool { abs(s.normal.y) < 0.3 && s.kind != "window" && !s.opening }

    static func place(_ t: WeatherTarget, surfaces: [Surface], head: HeadPose, metrics: TextMetrics, minShrink: Float, parallel: Float,
                      relation: SpatialRelation?, probe: DepthProbe) -> PlacedText? {
        var o = TextPlacement.SearchOptions()
        o.minShrink = minShrink; o.overflow = overflow; o.onSurface = 0.75; o.field = field; o.minFacing = minFacing
        switch t.kind {
        case "window":
            // Under the sill: near the middle of it, nothing above it.
            let bottom = t.center.y - t.height/2, sill = V3(t.center.x, bottom - sill - 0.15, t.center.z) + t.normal*0.02
            o.near = (sill, 0.8, { $0.y > bottom - 0.03 }); o.only = upright
            if let p = TextPlacement.search(in: surfaces, head: head, metrics: metrics, probe: probe, options: o).first { return p }
        case "ceiling":
            guard let wall = facedWall(surfaces, head: head) else { return TextPlacement.floating(head: head, metrics: metrics) }
            return underCeiling(wall.surface, at: wall.point, ceilingY: t.center.y, head: head, metrics: metrics)
        default:
            let table = t.horizontal ? t.surface : nil
            if let table {
                // Always on the table: the search over it (anywhere in front, not only in the comfortable view), else straight onto its
                // clearest free spot nearest the user. Never floating.
                let b = box(t), inv = InfoSelection.frame(b).inverse, h = b.size/2 + V3(0.02, 0.05, 0.02)
                o.near = (t.center, 1.5, { p in let l = inv.point(p); return abs(l.x) <= h.x && abs(l.y) <= h.y && abs(l.z) <= h.z }); o.only = { $0 === table }
                o.onSurface = 0.6; o.minFacing = 0; o.field = 3; o.overflow = 1; o.minShrink = min(minShrink, 0.4)   // a top is seen at a slant
                if let p = TextPlacement.search(in: surfaces, head: head, metrics: metrics, probe: probe, options: o).first { return p }
                return onTable(table, avoiding: b, head: head, metrics: metrics)
            }
            if let r = InfoPlacement.place(box: box(t), surfaces: surfaces, head: head, metrics: metrics, minShrink: minShrink, parallel: parallel,
                                           relation: relation, only: table.map { tb in { $0 === tb } } ?? upright, field: field, overflow: overflow, minFacing: minFacing, probe: probe) { return r.0 }
        }
        return InfoPlacement.place(box: box(t), surfaces: surfaces, head: head, metrics: metrics, minShrink: minShrink, parallel: parallel,
                                   relation: relation, only: upright, field: field, overflow: overflow, minFacing: minFacing, probe: probe)?.0
    }

    /// Text straight onto a wall, centred on `at` (kept inside the wall), facing the eye, its x-height the answers' angle there.
    static func onWall(_ s: Surface, at: V3, head: HeadPose, metrics: TextMetrics) -> PlacedText? {
        var n = s.normal; if simd_dot(n, head.eye - s.origin) < 0 { n = -n }
        guard let b = TextPlacement.basis(normal: n, at: at, eye: head.eye) else { return nil }
        let unit = TextPlacement.xHeightDeg(width: 1, metrics: metrics, at: at, up: b.up, eye: head.eye)
        let width = min(s.width*0.9, TextPlacement.targetDeg*metrics.scale/max(unit, 1e-4)), height = width*metrics.aspect
        var l = s.local(at)
        l.x = max(-s.width/2 + width/2, min(s.width/2 - width/2, l.x)); l.y = max(-s.height/2 + height/2, min(s.height/2 - height/2, l.y))
        let region = s.colors?.region(x0: l.x - width/2, x1: l.x + width/2, y0: l.y - height/2, y1: l.y + height/2)
        let clutter = region.map { $0.share*Legibility.clutter($0.features) + (1 - $0.share)*TextPlacement.unseenClutter } ?? TextPlacement.unseenClutter
        return PlacedText(surface: s, center: s.point(l) + n*TextPlacement.lift, right: b.right, up: b.up, normal: n, width: width, height: height,
                          style: Legibility.pick(pixels: region?.pixels ?? [], clutter: 0.4*clutter), cost: 0, clutter: clutter)
    }

    /// Text on a wall right below the ceiling, centred across from `at` (kept inside the wall), its x-height the answers' angle there.
    static func underCeiling(_ s: Surface, at: V3, ceilingY: Float, head: HeadPose, metrics: TextMetrics) -> PlacedText? {
        var n = s.normal; if simd_dot(n, head.eye - s.origin) < 0 { n = -n }
        guard let b = TextPlacement.basis(normal: n, at: at, eye: head.eye) else { return nil }
        let top = min(ceilingY, s.point(V2(0, s.height/2)).y) - underCeiling
        let probe = V3(at.x, top - 0.2, at.z)
        let unit = TextPlacement.xHeightDeg(width: 1, metrics: metrics, at: probe, up: b.up, eye: head.eye)
        let width = min(s.width*0.9, TextPlacement.targetDeg*metrics.scale/max(unit, 1e-4)), height = width*metrics.aspect
        var l = s.local(V3(at.x, top - height/2, at.z))
        l.x = max(-s.width/2 + width/2, min(s.width/2 - width/2, l.x))
        let contact = s.point(l)
        let region = s.colors?.region(x0: l.x - width/2, x1: l.x + width/2, y0: l.y - height/2, y1: l.y + height/2)
        let clutter = region.map { $0.share*Legibility.clutter($0.features) + (1 - $0.share)*TextPlacement.unseenClutter } ?? TextPlacement.unseenClutter
        let style = Legibility.pick(pixels: region?.pixels ?? [], clutter: 0.4*clutter)
        return PlacedText(surface: s, center: contact + n*TextPlacement.lift, right: b.right, up: b.up, normal: n, width: width, height: height, style: style, cost: 0, clutter: clutter)
    }

    /// Straight onto a table: of a grid over it, the spot off the weather's patch (and not over it) nearest the user and least cluttered,
    /// reading away from the user, as wide as reads there and fits on the top.
    /// near: a point to stay close to (an info answer's box), else the spot nearest the user.
    static func onTable(_ s: Surface, avoiding avoid: InfoTarget?, near: V3? = nil, head: HeadPose, metrics: TextMetrics) -> PlacedText? {
        var n = s.normal; if n.y < 0 { n = -n }
        let b = avoid ?? InfoTarget(id: "-", key: "", center: V3(0, -1000, 0), size: .zero, yaw: 0, label: nil)
        let inv = InfoSelection.frame(b).inverse, h = b.size/2 + V3(0.03, 0.05, 0.03)
        var best: (cost: Float, p: V3, clutter: Float)?
        for y in -5...5 { for x in -5...5 {
            let l = V2(Float(x)*s.width/11, Float(y)*s.height/11)
            guard s.contains(l) else { continue }
            let p = s.point(l), q = inv.point(p)
            if abs(q.x) <= h.x && abs(q.z) <= h.z { continue }
            let clutter = s.colors.map { g in let r = g.region(x0: l.x - 0.1, x1: l.x + 0.1, y0: l.y - 0.05, y1: l.y + 0.05, limit: 60); return r.share*Legibility.clutter(r.features) + (1 - r.share)*TextPlacement.unseenClutter } ?? TextPlacement.unseenClutter
            let cost = (near.map { 2*simd_distance(p.xz, $0.xz) } ?? 0) + simd_distance(p.xz, head.eye.xz) + 1.5*clutter
            if best == nil || cost < best!.cost { best = (cost, p, clutter) }
        } }
        guard let at = best, let basis = TextPlacement.basis(normal: n, at: at.p, eye: head.eye) else { return nil }
        let unit = TextPlacement.xHeightDeg(width: 1, metrics: metrics, at: at.p, up: basis.up, eye: head.eye)
        let wanted = TextPlacement.targetDeg*metrics.scale/max(unit, 1e-4)
        var width = wanted
        // Smaller until it lies on the top and off the patch; rather over the patch (the text is drawn over the weather) than under 60%
        // of the size wanted.
        func fits(_ w: Float, offPatch: Bool) -> Bool {
            let hh = w*metrics.aspect
            return [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5), (0, 0)].allSatisfy { (x: Float, y: Float) in
                let p = at.p + basis.right*(x*w) + basis.up*(y*hh), q = inv.point(p)
                return s.contains(p) && !(offPatch && abs(q.x) <= h.x && abs(q.z) <= h.z)
            }
        }
        while !fits(width, offPatch: true) && width > wanted*0.6 { width *= 0.9 }
        if !fits(width, offPatch: true) { width = wanted; while !fits(width, offPatch: false) && width > wanted*0.3 { width *= 0.9 } }
        let local = s.local(at.p)
        let region = s.colors?.region(x0: local.x - width/2, x1: local.x + width/2, y0: local.y - width*metrics.aspect/2, y1: local.y + width*metrics.aspect/2)
        let style = Legibility.pick(pixels: region?.pixels ?? [], clutter: 0.4*at.clutter)
        return PlacedText(surface: s, center: at.p + n*TextPlacement.lift, right: basis.right, up: basis.up, normal: n, width: width, height: width*metrics.aspect, style: style, cost: 0, clutter: at.clutter)
    }

    /// The wall the person faces most squarely: rays across ±30° of the levelled gaze, the first wall each meets, the one nearest square
    /// on (within 35°; nearer on a tie).
    static func facedWall(_ surfaces: [Surface], head: HeadPose) -> (surface: Surface, distance: Float, point: V3)? {
        var level = head.forward; level.y = 0
        guard level.length > 1e-3 else { return nil }
        level = level.normalized
        var best: (hit: (surface: Surface, distance: Float, point: V3), angle: Float)?
        for a in stride(from: Float(-30), through: 30, by: 10) {
            let d = simd_quatf(angle: radians(a), axis: worldUp).act(level)
            guard let h = SpatialRelations.firstHit(surfaces, head.eye, d, filter: { upright($0) && $0.family == "wall" }) else { continue }
            var n = h.surface.normal; n.y = 0; n = n.normalized
            let angle = degrees(acos(min(1, abs(simd_dot(n, level)))))
            guard angle <= 35 else { continue }
            if best == nil || angle < best!.angle - 3 || (abs(angle - best!.angle) <= 3 && h.distance < best!.hit.distance) { best = (h, angle) }
        }
        return best?.hit
    }
}
