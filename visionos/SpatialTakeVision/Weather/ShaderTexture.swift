import Metal
import RealityKit

/// A texture a compute kernel (Weather.metalsrc) draws into, shown by RealityKit (a LowLevelTexture: the GPU writes it in place each
/// frame, no copies). draw(params) runs the kernel once with its parameters (a plain struct matching the kernel's).
@MainActor
final class ShaderTexture {
    static let device = MTLCreateSystemDefaultDevice()
    static let queue = device?.makeCommandQueue()
    private static var pipelines: [String: MTLComputePipelineState] = [:]
    /// The kernels, compiled from their source (Weather.metalsrc, a resource) on first use: building the app then needs no Metal
    /// toolchain of its own.
    static let library: MTLLibrary? = {
        guard let device, let url = Bundle.main.url(forResource: "Weather", withExtension: "metalsrc"), let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        do { return try device.makeLibrary(source: source, options: nil) } catch { print("Weather shaders:", error); return nil }
    }()

    let resource: TextureResource
    private let texture: LowLevelTexture
    private let pipeline: MTLComputePipelineState
    let width: Int, height: Int

    init?(kernel: String, width: Int, height: Int) {
        guard let device = Self.device else { return nil }
        let pipeline: MTLComputePipelineState
        if let p = Self.pipelines[kernel] { pipeline = p }
        else {
            guard let f = Self.library?.makeFunction(name: kernel), let p = try? device.makeComputePipelineState(function: f) else { return nil }
            Self.pipelines[kernel] = p; pipeline = p
        }
        var d = LowLevelTexture.Descriptor()
        d.textureType = .type2D; d.pixelFormat = .rgba16Float; d.width = width; d.height = height; d.depth = 1
        d.mipmapLevelCount = 1; d.textureUsage = [.shaderRead, .shaderWrite]
        guard let t = try? LowLevelTexture(descriptor: d), let r = try? TextureResource(from: t) else { return nil }
        texture = t; resource = r; self.pipeline = pipeline; self.width = width; self.height = height
    }

    func draw<P>(_ params: P) {
        guard let queue = Self.queue, let cmd = queue.makeCommandBuffer() else { return }
        let target = texture.replace(using: cmd)
        guard let enc = cmd.makeComputeCommandEncoder() else { return }
        enc.setComputePipelineState(pipeline)
        enc.setTexture(target, index: 0)
        withUnsafeBytes(of: params) { enc.setBytes($0.baseAddress!, length: MemoryLayout<P>.stride, index: 0) }
        let w = pipeline.threadExecutionWidth, h = max(1, pipeline.maxTotalThreadsPerThreadgroup/w)
        enc.dispatchThreads(MTLSize(width: width, height: height, depth: 1), threadsPerThreadgroup: MTLSize(width: w, height: h, depth: 1))
        enc.endEncoding()
        cmd.commit()
    }

    /// An unlit, see-through material showing it (the kernels write premultiplied colour).
    func material(opacity: Float = 1) -> UnlitMaterial {
        var m = UnlitMaterial()
        m.color = .init(tint: .white, texture: .init(resource))
        m.blending = .transparent(opacity: .init(floatLiteral: opacity))
        m.writesDepth = false   // see-through layers: one must never hide what is behind it
        return m
    }
}

// The kernels' parameters (Weather.metalsrc: same fields, same order, same alignment).
struct GroundParams {
    var time: Float = 0, horizontal: Float = 0, whole: Float = 0, wet: Float = 0
    var snow: Float = 0, night: Float = 0, sunny: Float = 0, ceiling: Float = 0
    var opacity: Float = 0.8, intensity: Float = 0.5, contacts: Float = 0, flash: Float = 0
    var patchSize = SIMD2<Float>(1, 1)
    var low = SIMD4<Float>(0, 0, 0, 1), high = SIMD4<Float>(1, 1, 1, 1)
}
struct VolumeParams {
    var time: Float = 0, density: Float = 0.5, cloudShape: Float = 1, cloudSeed: Float = 0
    var tint = SIMD4<Float>(1, 1, 1, 1)
    var extent = SIMD3<Float>(1, 1, 1)
}
struct BodyParams { var time: Float = 0, night: Float = 0, phase: Float = 0, pad: Float = 0 }
