import ExpoModulesCore
import Foundation
import UIKit
import WatchConnectivity

public final class MizyunWorkoutCompanionModule: Module {
  private var bridge: WorkoutCompanionBridge?

  public func definition() -> ModuleDefinition {
    Name("MizyunWorkoutCompanion")
    Events("onMessage")
    OnCreate {
      DispatchQueue.main.async {
        guard Bundle.main.bundleIdentifier == "com.mizyun.development", WCSession.isSupported() else { return }
        self.bridge = WorkoutCompanionBridge { [weak self] json in
          self?.sendEvent("onMessage", ["json": json])
        }
      }
    }
    OnStartObserving("onMessage") { DispatchQueue.main.async { self.bridge?.observing = true } }
    OnStopObserving("onMessage") { DispatchQueue.main.async { self.bridge?.stop() } }
    OnAppEntersBackground { DispatchQueue.main.async { self.bridge?.clear() } }
    OnDestroy { DispatchQueue.main.async { self.bridge?.stop(); self.bridge = nil } }
    AsyncFunction("publish") { (json: String) -> Bool in self.bridge?.publish(json) ?? false }.runOnQueue(.main)
    AsyncFunction("clear") { self.bridge?.clear() }.runOnQueue(.main)
  }
}

private final class WorkoutCompanionBridge: NSObject, WCSessionDelegate {
  var observing = false
  private var nonce: String?
  private var authority: [String: Any]?
  private var inFlight: String?
  private let emit: (String) -> Void
  private let session = WCSession.default
  private var active: Bool { observing && UIApplication.shared.applicationState == .active }
  private var now: Double { Date().timeIntervalSince1970 * 1000 }

  init(emit: @escaping (String) -> Void) {
    self.emit = emit
    super.init()
    session.delegate = self
    session.activate()
  }

  func stop() { clear(); observing = false }

  func clear() {
    let message: [String: Any] = ["protocolVersion": 1, "kind": "clear", "reason": "inactive"]
    authority = nil
    nonce = nil
    inFlight = nil
    guard session.activationState == .activated else { return }
    try? session.updateApplicationContext(["json": encode(message)])
    if session.isReachable { session.sendMessage(["json": encode(message)], replyHandler: nil, errorHandler: { _ in }) }
    session.outstandingUserInfoTransfers.forEach { $0.cancel() }
  }

  func publish(_ json: String) -> Bool {
    guard active, json.utf8.count <= 16384,
          let data = json.data(using: .utf8),
          let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          value["protocolVersion"] as? Int == 1,
          session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return false }
    let kind = value["kind"] as? String
    if kind == "clear" { clear(); return true }
    guard let messageNonce = value["watchNonce"] as? String, messageNonce == nonce else { return false }
    if kind == "snapshot" {
      guard let binding = value["bindingId"] as? String, UUID(uuidString: binding) != nil,
            let workout = value["workoutId"] as? String, UUID(uuidString: workout) != nil,
            let issued = value["issuedAtMs"] as? Double, let expires = value["expiresAtMs"] as? Double,
            issued <= now + 10000, expires > now, expires > issued, expires - issued <= 120000 else { return false }
      guard session.isReachable else { return false }
      authority = value
      session.sendMessage(["json": json], replyHandler: nil, errorHandler: { _ in })
      return true
    }
    guard kind == "ack", let bound = authority,
          value["bindingId"] as? String == bound["bindingId"] as? String else { return false }
    guard session.isReachable else { return false }
    if value["operationId"] as? String == inFlight { inFlight = nil }
    session.sendMessage(["json": json], replyHandler: nil, errorHandler: { _ in })
    return true
  }

  private func receive(_ message: [String: Any]) {
    guard active, let json = message["json"] as? String, json.utf8.count <= 16384,
          let data = json.data(using: .utf8), let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          value["protocolVersion"] as? Int == 1,
          let incomingNonce = value["watchNonce"] as? String, UUID(uuidString: incomingNonce) != nil else { return }
    if value["kind"] as? String == "hello" {
      if inFlight != nil && incomingNonce != nonce { return }
      if incomingNonce != nonce { authority = nil }
      nonce = incomingNonce
      emit(json)
      return
    }
    guard ["log-set", "finish", "skip-rest"].contains(value["kind"] as? String ?? ""),
          incomingNonce == nonce, let bound = authority,
          let lease = bound["expiresAtMs"] as? Double, lease > now,
          value["bindingId"] as? String == bound["bindingId"] as? String,
          value["workoutId"] as? String == bound["workoutId"] as? String,
          let expires = value["expiresAtMs"] as? Double, let created = value["createdAtMs"] as? Double,
          expires > now, created <= now + 10000, expires > created, expires - created <= 120000,
          let operation = value["operationId"] as? String, UUID(uuidString: operation) != nil else { return }
    guard inFlight == nil || inFlight == operation else { return }
    inFlight = operation
    // A completed lease still admits exact receipt replay; JS rejects all new completed actions.
    // JS alone validates, serializes and performs authenticated mutations.
    emit(json)
  }

  private func encode(_ value: [String: Any]) -> String {
    String(data: (try? JSONSerialization.data(withJSONObject: value)) ?? Data(), encoding: .utf8) ?? "{}"
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
  func sessionDidBecomeInactive(_ session: WCSession) { DispatchQueue.main.async { self.clear() } }
  func sessionDidDeactivate(_ session: WCSession) { DispatchQueue.main.async { self.clear(); session.activate() } }
  func sessionWatchStateDidChange(_ session: WCSession) { DispatchQueue.main.async { self.clear() } }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    DispatchQueue.main.async { self.receive(message) }
  }
  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    DispatchQueue.main.async { self.receive(message); replyHandler(["received": true]) }
  }
  // Deliberately no persisted background command queue or background mutation path.
}
