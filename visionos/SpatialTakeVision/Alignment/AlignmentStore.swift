import Foundation
import simd

/// The saved alignment of a space: a world anchor placed at the space's origin (its transform is world-from-space), which visionOS keeps
/// across launches in the same room. Its id is remembered here per space; when ARKit reports that anchor again, the alignment is back.
/// The last transform is kept too, as a fallback until the anchor shows up (it is only right if the headset's world origin is the same).
struct AlignmentStore {
    let space: String
    private var anchorKey: String { "alignment.\(space).anchor" }
    private var matrixKey: String { "alignment.\(space).matrix" }

    var anchorID: UUID? {
        get { UserDefaults.standard.string(forKey: anchorKey).flatMap(UUID.init(uuidString:)) }
        nonmutating set { UserDefaults.standard.set(newValue?.uuidString, forKey: anchorKey) }
    }
    var lastTransform: simd_float4x4? {
        get {
            guard let a = UserDefaults.standard.array(forKey: matrixKey) as? [Float], a.count == 16 else { return nil }
            return simd_float4x4(SIMD4(a[0], a[1], a[2], a[3]), SIMD4(a[4], a[5], a[6], a[7]), SIMD4(a[8], a[9], a[10], a[11]), SIMD4(a[12], a[13], a[14], a[15]))
        }
        nonmutating set {
            guard let m = newValue else { UserDefaults.standard.removeObject(forKey: matrixKey); return }
            UserDefaults.standard.set([m.columns.0, m.columns.1, m.columns.2, m.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }, forKey: matrixKey)
        }
    }
}
