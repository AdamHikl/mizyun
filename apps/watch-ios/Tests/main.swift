import Foundation

let now: Int64 = 1000000
let workout = "11111111-1111-4111-8111-111111111111"
let binding = "22222222-2222-4222-8222-222222222222"
let otherBinding = "33333333-3333-4333-8333-333333333333"
var disk: CompanionPending?
let state = CompanionState { disk = $0 }
func snapshot(_ bindingId: String = binding, revision: Int = 1, expiry: Int64 = now + 60000, nonce: String? = nil) -> String {
  CompanionState.encode(CompanionSnapshot(protocolVersion: 1, kind: "snapshot", watchNonce: nonce ?? state.nonce,
    bindingId: bindingId, workoutId: workout, revision: revision, issuedAtMs: now, expiresAtMs: expiry, status: "active",
    exercise: CompanionExercise(exerciseId: "planned-squat", name: "Squat", completedSets: 0, targetSets: 3,
      repetitions: 8, loadKg: 20, setType: "working", loadUnit: "kg"), restEndsAtMs: now + 30000,
    restDurationSeconds: 30, canLogSet: true, canFinish: true))!
}
func require(_ test: Bool, _ label: String) { if !test { fatalError(label) } }
state.receive(snapshot(nonce: UUID().uuidString), now: now)
require(state.snapshot == nil, "old nonce rejected")
state.receive(snapshot(expiry: now + 120001), now: now)
require(state.snapshot == nil, "long lease rejected")
state.receive(snapshot(), now: now)
require(state.snapshot != nil, "fresh snapshot accepted")
require(state.enqueue(kind: "log-set", repetitions: 9, loadKg: 22.5, now: now), "planned exercise may log")
let exact = disk!.json
require(!state.enqueue(kind: "finish", now: now), "second command denied")
require(state.nextDelivery(now: now + 1) == exact, "immutable queued delivery")
require(state.nextDelivery(now: now + 2) == nil, "attempted command never replays")
state.tick(now: now + 15001)
require(state.pending?.phase == "uncertain", "lost receipt uncertain")
require(state.nextDelivery(now: now + 15002) == nil, "uncertain never retries")
let operation = (try! JSONDecoder().decode(CompanionCommand.self, from: exact.data(using: .utf8)!)).operationId
let wrongAck = CompanionAck(protocolVersion: 1, kind: "ack", watchNonce: state.nonce, bindingId: otherBinding, operationId: operation, status: "saved", reason: "saved", revision: 2)
state.receive(CompanionState.encode(wrongAck)!, now: now + 16000)
require(state.pending != nil, "wrong binding ack ignored")
let ack = CompanionAck(protocolVersion: 1, kind: "ack", watchNonce: state.nonce, bindingId: binding, operationId: operation, status: "saved", reason: "saved", revision: 2)
state.receive(CompanionState.encode(ack)!, now: now + 16000)
require(state.pending == nil && disk == nil, "late saved receipt resolves uncertainty")
state.receive(snapshot(revision: 3), now: now + 16000)
state.receive(snapshot(revision: 2), now: now + 16000)
require(state.snapshot?.revision == 3, "out of order revision rejected")
require(state.enqueue(kind: "finish", now: now + 17000), "finish queued")
state.receive(snapshot(otherBinding), now: now + 17000)
require(state.pending == nil && state.message.contains("discarded"), "new binding discards prior command visibly")
state.receive(snapshot(revision: 99), now: now + 17000)
require(state.snapshot?.bindingId == otherBinding, "retired binding rejected")
require(state.enqueue(kind: "skip-rest", now: now + 18000), "skip rest queued")
state.suspend()
require(disk != nil, "pending retained on background")
let previousNonce = state.nonce
state.activate(hadOutbox: true)
require(state.nonce != previousNonce && state.snapshot == nil && disk == nil && state.message.contains("Check phone"), "activation fresh and prior outbox discarded visibly")
state.receive(snapshot(UUID().uuidString), now: now)
state.tick(now: now + 60000)
require(state.snapshot == nil && !state.enqueue(kind: "finish", now: now + 60000), "expired snapshot disables commands")
let broken = CompanionState { _ in throw CocoaError(.fileWriteUnknown) }
let brokenSnapshot = snapshot(UUID().uuidString, nonce: broken.nonce)
broken.receive(brokenSnapshot, now: now)
require(!broken.enqueue(kind: "finish", now: now), "failed durable write does not send")
print("watchOS lease/outbox: 19 assertions passed")
