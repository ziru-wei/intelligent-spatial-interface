import Foundation
import simd

// Fine alignment after AutoAligner (whose planes are coarse: ARKit's plane extents, wall centres, no corners or seams): the room's mesh
// as the headset has reconstructed it, against the scan itself, point to plane (ICP).
//
//   scan    ScanCloud: the scan as points with normals (visionos/tools/bake_surface_colors.py scan_points: 400k spread evenly over its
//           surface, space coordinates), in a grid of CELL metres for finding the nearest.
//   live    the headset's mesh vertices (world), one per LIVE_SPACING cube, with their normals (WorldSensing.meshSamples).
//   fit     each live point, taken into space by the current alignment, pairs with the nearest scan point within a radius (shrinking
//           from 40 cm to 6 cm over the iterations) whose normal agrees (within 45°); the yaw about the live points' centre and the
//           translation that bring the pairs onto the scan's planes are solved by least squares (point to plane, Huber 2 cm), floors
//           and walls weighing the same in all (else the floor, most of the mesh, would drown out the walls that fix the rest).
//           Gravity is shared, so no roll or pitch.
//   clutter the room is full of things that move (tables, chairs, boxes, people) and may not be where the scan saw them: the fit
//           uses only the room's shell on both sides when there is enough of it: the headset's mesh faces ARKit classifies as wall,
//           floor, door or window, and the scan's points on the layout's wall faces (within 12 cm, facing the same way) and floors
//           (within 6 cm, facing up) (ScanCloud.shell). Else everything, outliers down-weighted.
//   scale   not applied (the layout is metric), but measured: the same fit with a scale about the centre too, as a check on the scan.
// The result: the inliers' RMS distance to the scan's planes, how many there were (of the live points), and the change made.

struct ScanCloud: Sendable {
    static let cell: Float = 0.1
    let points: [V3], normals: [V3]
    private let cells: [Int64: Range<Int>]   // into `order`
    private let order: [Int32]

    /// SpaceData/<space>/scan-points.bin: float32 x, y, z, nx, ny, nz per point.
    init?(space: String, bundle: Bundle = .main) {
        guard let url = bundle.url(forResource: "scan-points", withExtension: "bin", subdirectory: "SpaceData/\(space)"),
              let data = try? Data(contentsOf: url, options: .mappedIfSafe), data.count >= 24 else { return nil }
        let floats = data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        var p: [V3] = [], n: [V3] = []
        p.reserveCapacity(floats.count/6); n.reserveCapacity(floats.count/6)
        for i in stride(from: 0, to: floats.count - 5, by: 6) {
            p.append(V3(floats[i], floats[i + 1], floats[i + 2])); n.append(V3(floats[i + 3], floats[i + 4], floats[i + 5]).normalized)
        }
        self.init(points: p, normals: n)
    }

    init(points: [V3], normals: [V3]) {
        self.points = points; self.normals = normals
        guard !points.isEmpty else { cells = [:]; order = []; return }
        let keys = points.map { Self.key(Self.index($0)) }
        let sorted = keys.indices.sorted { keys[$0] < keys[$1] }
        var cells: [Int64: Range<Int>] = [:], start = 0
        for i in 1...sorted.count where i == sorted.count || keys[sorted[i]] != keys[sorted[start]] {
            cells[keys[sorted[start]]] = start..<i; start = i
        }
        self.cells = cells; self.order = sorted.map(Int32.init)
    }

    /// Only the points on the room's shell: the layout's wall faces (within 12 cm of one, facing the same way, along it) and its
    /// zones' floors (within 6 cm of one's height, facing up, inside its outline).
    func shell(_ sem: Semantic) -> ScanCloud {
        let faces = AutoAligner.faces(sem, zone: nil), floors = sem.rooms.compactMap { r in r.floorY.map { (r, Float($0)) } }
        var p: [V3] = [], n: [V3] = []
        for i in points.indices {
            let q = points[i], qn = normals[i]
            let onWall = faces.contains { f in
                let d = q - f.center
                return abs(simd_dot(d, f.normal)) < 0.12 && abs(simd_dot(qn, f.normal)) > 0.8 && abs(simd_dot(d, f.along)) <= f.length/2 + 0.1 && q.y > f.bottom - 0.1 && q.y < f.top + 0.1
            }
            let onFloor = !onWall && abs(qn.y) > 0.8 && floors.contains { abs(q.y - $0.1) < 0.06 && $0.0.contains(q) }
            if onWall || onFloor { p.append(q); n.append(qn) }
        }
        return ScanCloud(points: p, normals: n)
    }

    static func index(_ p: V3) -> SIMD3<Int32> { SIMD3<Int32>(Int32(floor(p.x/cell)), Int32(floor(p.y/cell)), Int32(floor(p.z/cell))) }
    static func key(_ c: SIMD3<Int32>) -> Int64 {
        let o: Int32 = 1 << 20
        return (Int64(c.x + o) << 42) | (Int64(c.y + o) << 21) | Int64(c.z + o)
    }

    /// The nearest scan point to `q` within `radius`.
    func nearest(_ q: V3, within radius: Float) -> Int? {
        let c = Self.index(q), k = Int32(ceil(radius/Self.cell))
        var best = -1, bestD = radius*radius
        for dx in -k...k { for dy in -k...k { for dz in -k...k {
            guard let r = cells[Self.key(c &+ SIMD3(dx, dy, dz))] else { continue }
            for o in r { let i = Int(order[o]), d = simd_distance_squared(points[i], q); if d < bestD { bestD = d; best = i } }
        } } }
        return best >= 0 ? best : nil
    }
}

struct ICPResult {
    let worldFromSpace: simd_float4x4
    let rms: Float               // metres, the inliers' distance to the scan's planes
    let inliers: Int, used: Int  // live points within 5 cm of the scan's planes (paired within the final radius), of all
    let scale: Float             // how much larger the scan is than the room (1: the same)
    let moved: Float, turned: Float   // the change made: metres, degrees
    var fraction: Float { used > 0 ? Float(inliers)/Float(used) : 0 }
    var summary: String {
        var s = String(format: "%.1f cm RMS over %d points (%.0f%% of the mesh); moved %.0f cm, turned %.1f°", rms*100, inliers, fraction*100, moved*100, turned)
        if abs(scale - 1) > 0.01 { s += String(format: ". The scan is %.1f%% %@ than the room", abs(scale - 1)*100, scale > 1 ? "larger" : "smaller") }
        return s
    }
}

enum ICPRefiner {
    static let iterations = 40, huber: Float = 0.02, normalAgree: Float = 0.7, minInliers = 300
    static func radius(_ i: Int) -> Float { max(0.06, 0.4*pow(0.85, Float(i))) }

    /// Refines `worldFromSpace` (yaw and translation) so the live points (world, with normals) lie on the scan.
    static func refine(_ worldFromSpace: simd_float4x4, live: [(p: V3, n: V3)], scan: ScanCloud) -> ICPResult? {
        guard live.count >= minInliers else { return nil }
        var S = worldFromSpace.inverse   // space from world
        for i in 0..<iterations {
            guard let step = solve(S, live: live, scan: scan, radius: radius(i), scale: false) else { return nil }
            S = step.update*S
            if step.size < 0.0005 && i >= 12 { break }   // under half a millimetre and a few hundredths of a degree
        }
        guard let final = solve(S, live: live, scan: scan, radius: radius(iterations), scale: false), final.inliers >= minInliers else { return nil }
        // Scale, as a check: the same fit with a scale about the centre too, on a copy.
        var Ss = S, scale: Float = 1
        for _ in 0..<10 {
            guard let step = solve(Ss, live: live, scan: scan, radius: radius(iterations), scale: true) else { break }
            Ss = step.update*Ss; scale *= step.scale
        }
        // The change, where the user is: how far the live points' centre moves against the layout.
        let m = S.inverse, d = m*worldFromSpace.inverse, cw = live.reduce(V3.zero) { $0 + $1.p }/Float(live.count)
        return ICPResult(worldFromSpace: m, rms: final.rms, inliers: final.inliers, used: live.count, scale: scale,
                         moved: simd_distance(d.point(cw), cw), turned: abs(degrees(wrapAngle(d.yaw))))
    }

    struct Step { let update: simd_float4x4; let size: Float; let scale: Float; let rms: Float; let inliers: Int }

    /// One step: pairs within `radius`, then the yaw (about the centre), translation (and, with `scale`, the scale) that best put them
    /// on the scan's planes. `update` applies in space.
    static func solve(_ S: simd_float4x4, live: [(p: V3, n: V3)], scan: ScanCloud, radius: Float, scale withScale: Bool) -> Step? {
        var pairs: [(q: V3, r: V3, n: V3)] = []; pairs.reserveCapacity(live.count)
        // Wide searches are slow: they take a sample of the live points (the fit is coarse then anyway).
        let every = radius > 0.15 ? max(1, live.count/4000) : 1
        for l in stride(from: 0, to: live.count, by: every).lazy.map({ live[$0] }) {
            let q = S.point(l.p)
            guard let j = scan.nearest(q, within: radius) else { continue }
            let n = scan.normals[j]
            if l.n != .zero, abs(simd_dot(S.vector(l.n), n)) < normalAgree { continue }
            pairs.append((q, scan.points[j], n))
        }
        guard pairs.count >= minInliers/max(1, every) else { return nil }
        let c = pairs.reduce(V3.zero) { $0 + $1.q }/Float(pairs.count)
        // Floors and ceilings against walls and the rest: each half of the weight.
        let flat = pairs.reduce(0) { $0 + (abs($1.n.y) > 0.8 ? 1 : 0) }, upright = pairs.count - flat
        let wFlat = flat > 0 ? 0.5/Double(flat) : 0, wUpright = upright > 0 ? 0.5/Double(upright) : 0
        let k = withScale ? 5 : 4
        var A = [Double](repeating: 0, count: 25), b = [Double](repeating: 0, count: 5), sq = 0.0, count = 0
        for p in pairs {
            let e = simd_dot(p.n, p.q - p.r), d = p.q - c
            // q' = c + R(δ)(q − c)·(1 + σ) + t: ∂/∂δ = (d.z, 0, −d.x), ∂/∂t = I, ∂/∂σ = d.
            let J = [Double(p.n.x*d.z - p.n.z*d.x), Double(p.n.x), Double(p.n.y), Double(p.n.z), Double(simd_dot(p.n, d))]
            let ae = abs(e), w = (abs(p.n.y) > 0.8 ? wFlat : wUpright)*Double(ae <= huber ? 1 : huber/ae)
            for r in 0..<k { b[r] -= w*J[r]*Double(e); for s in 0..<k { A[r*5 + s] += w*J[r]*J[s] } }
            if ae < 0.05 { sq += Double(e*e); count += 1 }
        }
        // A little damping, so a direction nothing constrains (one wall seen) stays put.
        let trace = (0..<k).reduce(0.0) { $0 + A[$1*5 + $1] }
        for r in 0..<k { A[r*5 + r] += 1e-4*trace/Double(k) }
        guard let x = gaussSolve(A, b, k) else { return nil }
        let δ = Float(x[0]), t = V3(Float(x[1]), Float(x[2]), Float(x[3])), σ = withScale ? Float(x[4]) : 0
        let R = simd_float4x4(yaw: δ, translation: .zero)
        var update = simd_float4x4(translation: c + t)*R*simd_float4x4(translation: -c)
        if withScale { update = simd_float4x4(translation: c + t)*R*simd_float4x4(diagonal: SIMD4(1 + σ, 1 + σ, 1 + σ, 1))*simd_float4x4(translation: -c) }
        // The step's size: the translation plus how far the turn moves a point 2 m from the centre.
        return Step(update: update, size: t.length + abs(δ)*2 + abs(σ)*2, scale: 1 + σ, rms: Float(sqrt(sq/Double(max(count, 1)))), inliers: count)
    }

    /// Solves the k × k system (row stride 5) by Gaussian elimination with partial pivoting.
    static func gaussSolve(_ A0: [Double], _ b0: [Double], _ k: Int) -> [Double]? {
        var A = A0, b = b0
        for col in 0..<k {
            guard let piv = (col..<k).max(by: { abs(A[$0*5 + col]) < abs(A[$1*5 + col]) }), abs(A[piv*5 + col]) > 1e-12 else { return nil }
            if piv != col { for j in 0..<k { A.swapAt(piv*5 + j, col*5 + j) }; b.swapAt(piv, col) }
            for r in (col + 1)..<k {
                let f = A[r*5 + col]/A[col*5 + col]
                for j in col..<k { A[r*5 + j] -= f*A[col*5 + j] }; b[r] -= f*b[col]
            }
        }
        var x = [Double](repeating: 0, count: k)
        for r in stride(from: k - 1, through: 0, by: -1) {
            var s = b[r]; for j in (r + 1)..<k { s -= A[r*5 + j]*x[j] }; x[r] = s/A[r*5 + r]
        }
        return x
    }
}
