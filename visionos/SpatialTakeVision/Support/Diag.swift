import Foundation

/// Startup diagnostics, printed to the console (Xcode, or `xcrun devicectl device process launch --console`): steps with the time since
/// launch, and the main thread held up for more than STALL seconds (the window and the room stop responding then), with the step it was
/// in and for how long.
enum Diag {
    static let stall: TimeInterval = 0.3
    private static let start = Date()
    private static let lock = NSLock()
    nonisolated(unsafe) private static var step = "launch"
    nonisolated(unsafe) private static var beat = Date()

    static func mark(_ s: String) {
        lock.lock(); step = s; lock.unlock()
        print(String(format: "[diag %6.2fs] %@", Date().timeIntervalSince(start), s))
    }

    /// Runs `body`, noting it when it takes longer than 0.1 s.
    @discardableResult static func time<T>(_ label: String, _ body: () throws -> T) rethrows -> T {
        let t = Date(); defer { let d = Date().timeIntervalSince(t); if d > 0.1 { print(String(format: "[diag %6.2fs] slow: %@ %.2fs", Date().timeIntervalSince(start), label, d)) } }
        return try body()
    }

    /// Watches the main thread from a background thread.
    static func watchMain() {
        Thread.detachNewThread {
            var blockedSince: Date?, blockedStep = ""
            while true {
                DispatchQueue.main.async { lock.lock(); beat = Date(); lock.unlock() }
                Thread.sleep(forTimeInterval: 0.1)
                lock.lock(); let last = beat, s = step; lock.unlock()
                let late = Date().timeIntervalSince(last)
                if late > stall, blockedSince == nil { blockedSince = last; blockedStep = s }
                if late <= stall, let b = blockedSince {
                    print(String(format: "[diag %6.2fs] main thread held %.2fs (from step: %@, now: %@)", Date().timeIntervalSince(start), last.timeIntervalSince(b), blockedStep, s))
                    blockedSince = nil
                }
            }
        }
    }
}
