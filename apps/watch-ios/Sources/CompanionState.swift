import Foundation

struct CompanionExercise: Codable {
  let exerciseId: String
  let name: String
  let completedSets: Int
  let targetSets: Int
  let repetitions: Int?
  let loadKg: Double?
  let setType: String
  let loadUnit: String
}
struct CompanionSnapshot: Codable {
  let protocolVersion: Int
  let kind: String
  let watchNonce: String
  let bindingId: String
  let workoutId: String
  let revision: Int
  let issuedAtMs: Int64
  let expiresAtMs: Int64
  let status: String
  let exercise: CompanionExercise?
  let restEndsAtMs: Int64?
  let restDurationSeconds: Int?
  let canLogSet: Bool
  let canFinish: Bool
}
struct CompanionCommand: Codable {
  let protocolVersion: Int
  let kind: String
  let watchNonce: String
  let bindingId: String
  let workoutId: String
  let operationId: String
  let baseRevision: Int
  let createdAtMs: Int64
  let expiresAtMs: Int64
  let exerciseId: String?
  let repetitions: Int?
  let loadKg: Double?
  let setType: String?
}
struct CompanionPending: Codable {
  let json: String
  var phase: String
  var sentAtMs: Int64?
}
struct CompanionAck: Codable {
  let protocolVersion: Int
  let kind: String
  let watchNonce: String
  let bindingId: String
  let operationId: String
  let status: String
  let reason: String
  let revision: Int
}

/// Pure lease/outbox policy. Snapshots and binding history never go to disk.
final class CompanionState {
  private(set) var nonce = UUID().uuidString
  private(set) var snapshot: CompanionSnapshot?
  private(set) var pending: CompanionPending?
  private(set) var message = "Open Mizyun Dev on your phone"
  private var retired = Set<String>()
  private var highRevision = -1
  private var lastBinding: String?
  private let persist: (CompanionPending?) throws -> Void

  init(persist: @escaping (CompanionPending?) throws -> Void) { self.persist = persist }
  static func encode<T: Encodable>(_ value: T) -> String? {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    return (try? encoder.encode(value)).flatMap { String(data: $0, encoding: .utf8) }
  }
  private func decoded<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
    guard json.utf8.count <= 16384, let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }
  func activate(hadOutbox: Bool = false) {
    let unresolved = pending != nil || hadOutbox
    if let binding = lastBinding { retired.insert(binding) }
    nonce = UUID().uuidString; snapshot = nil; pending = nil; lastBinding = nil; highRevision = -1
    do { try persist(nil) } catch { message = "Check phone · local storage unavailable"; return }
    message = unresolved ? "Previous request discarded · Check phone" : "Open Mizyun Dev on your phone"
  }
  var hello: String { "{\"protocolVersion\":1,\"kind\":\"hello\",\"watchNonce\":\"\(nonce)\"}" }
  func suspend() {
    snapshot = nil
    if pending?.phase == "awaiting" { uncertain() }
  }
  func clear() {
    if let binding = lastBinding { retired.insert(binding) }
    snapshot = nil; pending = nil; lastBinding = nil; highRevision = -1
    do { try persist(nil); message = "Open Mizyun Dev on your phone" }
    catch { message = "Check phone · local storage unavailable" }
  }
  private func valid(_ state: CompanionSnapshot, now: Int64) -> Bool {
    state.protocolVersion == 1 && state.kind == "snapshot" && state.watchNonce == nonce &&
      UUID(uuidString: state.bindingId) != nil && UUID(uuidString: state.workoutId) != nil &&
      state.revision >= 0 && state.issuedAtMs > 0 && state.issuedAtMs <= now + 10000 &&
      state.expiresAtMs > now && state.expiresAtMs > state.issuedAtMs &&
      state.expiresAtMs - state.issuedAtMs <= 120000 &&
      ["active", "completed", "unavailable"].contains(state.status)
  }
  func receive(_ json: String, now: Int64) {
    guard json.utf8.count <= 16384, let data = json.data(using: .utf8),
          let envelope = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          envelope["protocolVersion"] as? Int == 1 else { return }
    if envelope["kind"] as? String == "clear" {
      if let target = envelope["watchNonce"] as? String, target != nonce { return }
      clear(); return
    }
    if envelope["kind"] as? String == "ack", let ack = decoded(CompanionAck.self, json),
       let item = pending, let command = decoded(CompanionCommand.self, item.json),
       ack.watchNonce == nonce, ack.bindingId == command.bindingId, ack.operationId == command.operationId,
       ack.revision >= command.baseRevision {
      if ack.status == "saved" || ack.status == "rejected" {
        do { try persist(nil); pending = nil } catch { uncertain(); return }
        message = ack.status == "saved" ? "Saved on phone" : "Request rejected · Check phone"
      } else if ack.status == "uncertain" { uncertain() }
      return
    }
    guard let next = decoded(CompanionSnapshot.self, json), valid(next, now: now), !retired.contains(next.bindingId) else { return }
    if next.bindingId == lastBinding {
      guard next.revision >= highRevision else { return }
      if next.revision == highRevision, let previous = snapshot {
        // Same revision may renew a lease, but may never rewind issue time.
        guard next.issuedAtMs >= previous.issuedAtMs else { return }
      }
    } else {
      if let old = lastBinding { retired.insert(old) }
      if pending != nil {
        do { try persist(nil); pending = nil; message = "Workout changed · request discarded · Check phone" }
        catch { uncertain(); return }
      }
      lastBinding = next.bindingId; highRevision = -1
    }
    highRevision = next.revision; snapshot = next
    if next.status != "active" {
      if pending != nil { message = "Workout ended · Check phone" }
      else { message = next.status == "completed" ? "Workout completed" : "Open workout on phone" }
    }
  }
  func tick(now: Int64) {
    if let current = snapshot, current.expiresAtMs <= now { snapshot = nil; message = "Snapshot expired · Open phone" }
    if let item = pending {
      if let command = decoded(CompanionCommand.self, item.json), command.expiresAtMs <= now { uncertain() }
      else if item.phase == "awaiting", let sent = item.sentAtMs, now - sent >= 15000 { uncertain() }
    }
  }
  var blocked: Bool { pending != nil }
  func enqueue(kind: String, repetitions: Int? = nil, loadKg: Double? = nil, now: Int64) -> Bool {
    tick(now: now)
    guard pending == nil, let current = snapshot, current.status == "active",
          (kind == "log-set" && current.canLogSet || kind == "finish" && current.canFinish ||
           kind == "skip-rest" && (current.restEndsAtMs ?? 0) > now) else { return false }
    if kind == "log-set" {
      guard let reps = repetitions, reps > 0, reps <= 1000, let load = loadKg, load.isFinite, load >= 0, load <= 2000,
            let exercise = current.exercise, !exercise.exerciseId.isEmpty, exercise.exerciseId.count <= 100,
            ["warmup", "working", "drop", "failure"].contains(exercise.setType) else { return false }
    }
    let command = CompanionCommand(protocolVersion: 1, kind: kind, watchNonce: nonce,
      bindingId: current.bindingId, workoutId: current.workoutId, operationId: UUID().uuidString,
      baseRevision: current.revision, createdAtMs: now, expiresAtMs: min(current.expiresAtMs, now + 120000),
      exerciseId: kind == "log-set" ? current.exercise?.exerciseId : nil,
      repetitions: kind == "log-set" ? repetitions : nil, loadKg: kind == "log-set" ? loadKg : nil,
      setType: kind == "log-set" ? current.exercise?.setType : nil)
    guard let json = Self.encode(command) else { return false }
    let item = CompanionPending(json: json, phase: "queued", sentAtMs: nil)
    do { try persist(item); pending = item; message = "Waiting for phone"; return true }
    catch { message = "Check phone · local storage unavailable"; return false }
  }
  /// Mark attempted delivery durably before handing the exact immutable body to transport.
  func nextDelivery(now: Int64) -> String? {
    tick(now: now)
    guard var item = pending, item.phase == "queued", let current = snapshot,
          let command = decoded(CompanionCommand.self, item.json), command.watchNonce == nonce,
          command.bindingId == current.bindingId, current.status == "active", command.expiresAtMs > now else { return nil }
    item.phase = "awaiting"; item.sentAtMs = now
    do { try persist(item); pending = item; message = "Saving on phone…"; return item.json }
    catch { uncertain(); return nil }
  }
  func uncertain() {
    if var item = pending { item.phase = "uncertain"; pending = item; try? persist(item) }
    message = "Check phone · save not confirmed"
  }
}
