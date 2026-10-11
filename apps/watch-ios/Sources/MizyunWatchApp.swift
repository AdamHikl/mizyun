import SwiftUI
import WatchConnectivity
import WatchKit

@main
struct MizyunWatchApp: App {
  @StateObject private var model = WatchWorkoutModel()
  @Environment(\.scenePhase) private var phase
  var body: some Scene {
    WindowGroup {
      WorkoutView(model: model)
        .onChange(of: phase) { _, value in
          if value == .active { model.activate() }
          else if value == .background { model.suspend() }
        }
    }
  }
}

final class WatchWorkoutModel: NSObject, ObservableObject, WCSessionDelegate {
  @Published var state: CompanionState
  @Published var repetitions = 8
  @Published var load = 0.0
  @Published var now = Int64(Date().timeIntervalSince1970 * 1000)
  private var timer: Timer?
  private var restAlerted: Int64?
  private var isActive = false
  private var lastHelloAt: Int64 = 0
  private let outboxURL: URL
  private let session = WCSession.default

  override init() {
    var root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    root.appendPathComponent("MizyunCompanion", isDirectory: true)
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    try? root.setResourceValues(values)
    let file = root.appendingPathComponent("pending.json")
    outboxURL = file
    state = CompanionState { pending in
      if let pending {
        let bytes = try JSONEncoder().encode(pending)
        guard bytes.count <= 16384 else { throw CocoaError(.fileWriteUnknown) }
        try bytes.write(to: file, options: [.atomic, .completeFileProtection])
        var excludedFile = file; try excludedFile.setResourceValues(values)
      } else if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
    super.init()
    if WCSession.isSupported() { session.delegate = self; session.activate() }
    activate()
  }
  func activate() {
    guard !isActive else { return }
    isActive = true
    state.activate(hadOutbox: FileManager.default.fileExists(atPath: outboxURL.path))
    objectWillChange.send()
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    hello()
  }
  func suspend() { isActive = false; timer?.invalidate(); timer = nil; state.suspend(); objectWillChange.send() }
  func tick() {
    now = Int64(Date().timeIntervalSince1970 * 1000)
    let rest = state.snapshot?.restEndsAtMs
    state.tick(now: now)
    if state.snapshot != nil, let end = rest, end <= now, restAlerted != end { restAlerted = end; WKInterfaceDevice.current().play(.notification) }
    objectWillChange.send()
    if state.snapshot == nil && now - lastHelloAt >= 5000 { hello() }
    flush()
  }
  func hello() {
    guard isActive, session.activationState == .activated, session.isReachable else { return }
    lastHelloAt = Int64(Date().timeIntervalSince1970 * 1000)
    session.sendMessage(["json": state.hello], replyHandler: nil, errorHandler: { _ in })
  }
  func submit(_ kind: String) {
    let kg = state.snapshot?.exercise?.loadUnit == "lb" ? load * 0.45359237 : load
    if state.enqueue(kind: kind, repetitions: repetitions, loadKg: kg, now: now) { flush() }
    objectWillChange.send()
  }
  private func flush() {
    guard isActive, session.activationState == .activated, session.isReachable,
          let json = state.nextDelivery(now: now) else { return }
    session.sendMessage(["json": json], replyHandler: nil, errorHandler: { [weak self] _ in
      DispatchQueue.main.async { self?.state.uncertain(); self?.objectWillChange.send() }
    })
  }
  private func receive(_ message: [String: Any]) {
    guard isActive, let json = message["json"] as? String else { return }
    let previous = state.snapshot
    state.receive(json, now: Int64(Date().timeIntervalSince1970 * 1000))
    if let exercise = state.snapshot?.exercise,
       previous?.exercise?.exerciseId != exercise.exerciseId || previous?.revision != state.snapshot?.revision {
      repetitions = exercise.repetitions ?? 8
      load = (exercise.loadKg ?? 0) / (exercise.loadUnit == "lb" ? 0.45359237 : 1)
    }
    objectWillChange.send(); flush()
  }
  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    DispatchQueue.main.async { self.hello() }
  }
  func sessionReachabilityDidChange(_ session: WCSession) { DispatchQueue.main.async { self.hello(); self.flush() } }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { DispatchQueue.main.async { self.receive(message) } }
  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    DispatchQueue.main.async { self.receive(applicationContext) }
  }
}

private struct WorkoutView: View {
  @ObservedObject var model: WatchWorkoutModel
  @State private var confirmFinish = false
  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        Text("Mizyun Dev").font(.caption).foregroundStyle(.secondary)
        if let snapshot = model.state.snapshot, snapshot.status == "active" {
          if let exercise = snapshot.exercise {
            Text(exercise.name).font(.headline).multilineTextAlignment(.center)
            Text("\(exercise.completedSets) of \(exercise.targetSets) sets · \(exercise.setType)").font(.caption)
            Stepper("Reps: \(model.repetitions)", value: $model.repetitions, in: 1...1000)
            Stepper(value: $model.load, in: 0...2000, step: 0.5) {
              Text("\(model.load, specifier: "%.1f") \(exercise.loadUnit)")
            }
            Button("Log set") { model.submit("log-set") }
              .disabled(!snapshot.canLogSet || model.state.blocked)
          }
          if let end = snapshot.restEndsAtMs, end > model.now {
            Text("Rest \(max(0, (end - model.now + 999) / 1000))s").monospacedDigit()
            Button("Skip rest") { model.submit("skip-rest") }.disabled(model.state.blocked)
          }
          Button("Finish workout") { confirmFinish = true }
            .disabled(!snapshot.canFinish || model.state.blocked)
        }
        Text(model.state.message).font(.caption).multilineTextAlignment(.center)
        if model.state.snapshot == nil { Button("Connect to phone") { model.hello() } }
      }.padding(.horizontal, 6)
    }
    .confirmationDialog("Finish this workout on your phone?", isPresented: $confirmFinish) {
      Button("Finish workout", role: .destructive) { model.submit("finish") }
      Button("Keep working out", role: .cancel) {}
    }
  }
}
