import simd

// Small vector and transform helpers. Two frames are used throughout:
//   world  the headset's (ARKit) frame
//   space  the scene's frame, as the web editor keeps it (scan/semantic.json; metres, +y up)
// AppModel.worldFromSpace maps space to world (a yaw and a translation: both frames are gravity aligned).
typealias V3 = SIMD3<Float>
typealias V2 = SIMD2<Float>

let worldUp = V3(0, 1, 0)

extension SIMD3 where Scalar == Float {
    var length: Float { simd_length(self) }
    var normalized: V3 { let l = simd_length(self); return l > 1e-9 ? self / l : self }
    init(_ a: [Double]) { self.init(Float(a[0]), Float(a[1]), Float(a[2])) }
    var xz: V2 { V2(x, z) }
}

extension SIMD2 where Scalar == Float {
    var length: Float { simd_length(self) }
    var normalized: V2 { let l = simd_length(self); return l > 1e-9 ? self / l : self }
}

extension simd_float4x4 {
    init(translation t: V3) { self = matrix_identity_float4x4; columns.3 = SIMD4(t, 1) }
    /// A rotation about +y by `yaw` radians, then a translation.
    init(yaw: Float, translation t: V3) {
        let c = cos(yaw), s = sin(yaw)
        self.init(SIMD4(c, 0, -s, 0), SIMD4(0, 1, 0, 0), SIMD4(s, 0, c, 0), SIMD4(t, 1))
    }
    /// A frame from its axes and origin.
    init(right: V3, up: V3, normal: V3, origin: V3) {
        self.init(SIMD4(right, 0), SIMD4(up, 0), SIMD4(normal, 0), SIMD4(origin, 1))
    }
    var translation: V3 { V3(columns.3.x, columns.3.y, columns.3.z) }
    var xAxis: V3 { V3(columns.0.x, columns.0.y, columns.0.z) }
    var yAxis: V3 { V3(columns.1.x, columns.1.y, columns.1.z) }
    var zAxis: V3 { V3(columns.2.x, columns.2.y, columns.2.z) }
    func point(_ p: V3) -> V3 { let r = self * SIMD4(p, 1); return V3(r.x, r.y, r.z) }
    func vector(_ v: V3) -> V3 { let r = self * SIMD4(v, 0); return V3(r.x, r.y, r.z) }
    /// Its yaw (radians about +y), read off its x axis.
    var yaw: Float { atan2(-columns.0.z, columns.0.x) }
}

/// The yaw of a horizontal direction, as simd_float4x4(yaw:) uses it: the angle that turns +z onto `d`.
func yawOf(_ d: V3) -> Float { atan2(d.x, d.z) }
func wrapAngle(_ a: Float) -> Float { atan2(sin(a), cos(a)) }
func degrees(_ r: Float) -> Float { r*180 / .pi }
func radians(_ d: Float) -> Float { d * .pi/180 }
func clamp01(_ v: Float) -> Float { min(1, max(0, v)) }
/// 1 at or below `full`, 0 at or above `zero`, linear between (src/placement.mjs ramp).
func ramp(_ v: Float, _ full: Float, _ zero: Float) -> Float { v <= full ? 1 : v >= zero ? 0 : (zero-v)/(zero-full) }
