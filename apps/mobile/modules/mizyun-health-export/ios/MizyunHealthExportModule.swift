import ExpoModulesCore
import CoreFoundation
import HealthKit
import UIKit

public final class MizyunHealthExportModule: Module {
  private let store = HKHealthStore()
  // Mutable state is main-queue confined. No health data or identifiers persist here.
  private var generation = 0
  private var pending: PendingExport?
  private var permissionPending = false
  private var permissionPromise: Promise?
  private var permissionTimeout: DispatchWorkItem?
  private var revisions: [String: Double] = [:]
  private let nutrients: [(String, String, HKQuantityTypeIdentifier)] = [
    ("energy", "energyKcal", .dietaryEnergyConsumed),
    ("protein", "proteinG", .dietaryProtein),
    ("carbs", "carbsG", .dietaryCarbohydrates),
    ("fat", "fatG", .dietaryFatTotal)
  ]

  public func definition() -> ModuleDefinition {
    Name("MizyunHealthExport")
    AsyncFunction("availabilityAsync") { () -> [String: Any] in
      self.result(HKHealthStore.isHealthDataAvailable() ? "ready" : "unavailable")
    }.runOnQueue(.main)
    AsyncFunction("installationIdAsync") { () -> String? in self.installationId() }.runOnQueue(.main)
    AsyncFunction("requestWritePermissionAsync") { (category: String, promise: Promise) in
      self.requestPermission(category, promise)
    }.runOnQueue(.main)
    AsyncFunction("applyOperationAsync") { (raw: [String: Any], promise: Promise) in
      self.apply(raw, promise)
    }.runOnQueue(.main)
    AsyncFunction("invalidateAsync") { () in self.invalidate() }.runOnQueue(.main)
    OnAppEntersBackground { self.invalidateOnMain(cancelPermission: false) }
    OnDestroy { self.invalidateOnMain() }
  }

  private func types(_ category: String) -> [HKSampleType]? {
    if category == "workout" { return [HKObjectType.workoutType()] }
    if category == "nutrition" {
      let values = nutrients.compactMap { HKObjectType.quantityType(forIdentifier: $0.2) }
      return values.count == nutrients.count ? values : nil
    }
    return nil
  }

  private func access(_ types: [HKSampleType]) -> String {
    let states = types.map { store.authorizationStatus(for: $0) }
    if states.allSatisfy({ $0 == .sharingAuthorized }) { return "granted" }
    if states.contains(.sharingAuthorized) { return "partial" }
    if states.contains(.sharingDenied) { return "denied" }
    return "unknown"
  }

  private func result(
    _ status: String, acknowledged: [String] = [], access: String = "unknown", code: String? = nil
  ) -> [String: Any] {
    var value: [String: Any] = [
      "status": status, "acknowledgedComponents": acknowledged, "writeAccess": access
    ]
    if let code { value["errorCode"] = code }
    return value
  }

  private func requestPermission(_ category: String, _ promise: Promise) {
    guard let selected = types(category) else {
      promise.resolve(result("error", code: "invalid_category")); return
    }
    guard HKHealthStore.isHealthDataAvailable() else {
      promise.resolve(result("unavailable")); return
    }
    guard UIApplication.shared.applicationState == .active else {
      promise.resolve(result("error", code: "foreground_required")); return
    }
    guard !permissionPending else {
      promise.resolve(result("error", code: "permission_busy")); return
    }
    permissionPending = true
    permissionPromise = promise
    let timeout = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.permissionPromise?.resolve(self.result("error", code: "permission_timeout"))
      self.permissionPromise = nil
      self.permissionTimeout = nil
      // Retain the launch gate: system authorization sheets cannot be cancelled.
    }
    permissionTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: timeout)
    store.requestAuthorization(toShare: Set(selected), read: []) { [weak self] completed, error in
      DispatchQueue.main.async {
        guard let self else { return }
        self.permissionTimeout?.cancel()
        self.permissionTimeout = nil
        self.permissionPending = false
        let writeAccess = self.access(selected)
        self.permissionPromise?.resolve(self.result(
          HealthExportAuthorizationPolicy.status(completed: completed, failed: error != nil, writeAccess: writeAccess),
          access: writeAccess, code: completed && error == nil ? nil : "permission_request_failed"
        ))
        self.permissionPromise = nil
      }
    }
  }

  private func apply(_ raw: [String: Any], _ promise: Promise) {
    guard let operation = ExportOperation.parse(raw, nutrients: nutrients) else {
      promise.resolve(result("error", code: "invalid_operation")); return
    }
    guard HKHealthStore.isHealthDataAvailable() else {
      promise.resolve(result("unavailable")); return
    }
    guard UIApplication.shared.applicationState == .active else {
      promise.resolve(result("error", code: "foreground_required")); return
    }
    guard pending == nil else {
      promise.resolve(result("error", code: "operation_busy")); return
    }
    let key = operation.category + ":" + operation.clientId
    if let revision = revisions[key], revision > operation.revision {
      promise.resolve(result("error", code: "stale_revision")); return
    }
    // A bounded ephemeral revision fence supplements the durable serialized outbox.
    if revisions.count >= 512 { revisions.removeAll() }
    revisions[key] = operation.revision
    let request = PendingExport(operation: operation, promise: promise, generation: generation)
    pending = request
    let timeout = DispatchWorkItem { [weak self, weak request] in
      guard let self, let request, self.pending === request else { return }
      request.retired = true
      request.promise?.resolve(self.result(
        request.acknowledged.isEmpty ? "error" : "partial",
        acknowledged: request.acknowledged, code: "operation_timeout"
      ))
      request.promise = nil
      // An in-flight HealthKit save/delete has no cancellation API. Keep the
      // mutation gate until its callback, then stop before the next component.
    }
    request.timeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
    step(request)
  }

  private func step(_ request: PendingExport) {
    guard pending === request else { return }
    guard !request.retired, request.generation == generation,
          UIApplication.shared.applicationState == .active else {
      finish(request, code: "operation_invalidated"); return
    }
    let operation = request.operation
    let components = operation.category == "workout" ? ["workout"] : nutrients.map { $0.0 }
    guard request.offset < components.count else { finish(request); return }
    let component = components[request.offset]
    let type: HKSampleType
    if component == "workout" { type = HKObjectType.workoutType() }
    else {
      guard let entry = nutrients.first(where: { $0.0 == component }),
            let quantityType = HKObjectType.quantityType(forIdentifier: entry.2) else {
        finish(request, code: "type_unavailable"); return
      }
      type = quantityType
    }
    guard store.authorizationStatus(for: type) == .sharingAuthorized else {
      request.failed = true
      request.permissionMissing = true
      request.offset += 1
      step(request); return
    }
    let syncId = "mizyun.export.v1.\(operation.clientId).\(component)"
    let completion: (Bool, Error?) -> Void = { [weak self, weak request] success, _ in
      DispatchQueue.main.async {
        guard let self, let request, self.pending === request else { return }
        if success { request.acknowledged.append(component) }
        else { request.failed = true }
        request.offset += 1
        self.step(request)
      }
    }
    if operation.type == "delete" || (component != "workout" && operation.values[component] == nil) {
      // Delete only this app's exact component. No read authorization or query
      // of somebody else's samples is necessary for HealthKit's own-object API.
      let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
        HKQuery.predicateForObjects(from: HKSource.default()),
        HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: [syncId]),
        HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncVersion, operatorType: .lessThanOrEqualTo,
          value: NSNumber(value: operation.revision))
      ])
      store.deleteObjects(of: type, predicate: predicate) { success, _, error in completion(success, error) }
      return
    }
    let metadata: [String: Any] = [
      HKMetadataKeySyncIdentifier: syncId,
      HKMetadataKeySyncVersion: NSNumber(value: operation.revision),
      HKMetadataKeyWasUserEntered: true
    ]
    let sample: HKSample
    if component == "workout" {
      sample = HKWorkout(
        activityType: .traditionalStrengthTraining,
        start: operation.start, end: operation.end,
        duration: operation.end.timeIntervalSince(operation.start),
        totalEnergyBurned: nil, totalDistance: nil, metadata: metadata
      )
    } else {
      guard let quantityType = type as? HKQuantityType, let value = operation.values[component] else {
        finish(request, code: "invalid_operation"); return
      }
      sample = HKQuantitySample(
        type: quantityType,
        quantity: HKQuantity(unit: component == "energy" ? .kilocalorie() : .gram(), doubleValue: value),
        start: operation.start, end: operation.start, metadata: metadata
      )
    }
    // Sync ID + version replaces older versions and makes same-version replay
    // idempotent even when the previous response was lost. Never delete first.
    store.save(sample, withCompletion: completion)
  }

  private func finish(_ request: PendingExport, code: String? = nil) {
    guard pending === request else { return }
    request.timeout?.cancel()
    pending = nil
    let selected = types(request.operation.category) ?? []
    let status: String
    if request.retired || request.generation != generation { status = "error" }
    else if code != nil || request.failed {
      status = request.acknowledged.isEmpty ? (request.permissionMissing ? "permission_required" : "error") : "partial"
    } else { status = "ready" }
    request.promise?.resolve(result(
      status, acknowledged: request.retired || request.generation != generation ? [] : request.acknowledged,
      access: access(selected), code: code ?? (request.failed ? "operation_incomplete" : nil)
    ))
    request.promise = nil
  }

  private func invalidateOnMain(cancelPermission: Bool = true) {
    if Thread.isMainThread { invalidate(cancelPermission: cancelPermission) }
    else { DispatchQueue.main.async { [weak self] in self?.invalidate(cancelPermission: cancelPermission) } }
  }

  private func installationId() -> String? {
    do {
      let manager = FileManager.default
      let support = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask,
        appropriateFor: nil, create: true)
      var directory = support.appendingPathComponent("MizyunHealthExportInstall", isDirectory: true)
      try manager.createDirectory(at: directory, withIntermediateDirectories: true)
      var excluded = URLResourceValues()
      excluded.isExcludedFromBackup = true
      try directory.setResourceValues(excluded)
      var file = directory.appendingPathComponent("install-id")
      if manager.fileExists(atPath: file.path) {
        let value = try String(contentsOf: file, encoding: .utf8)
        guard value.count == 36, UUID(uuidString: value) != nil else { return nil }
        try file.setResourceValues(excluded)
        try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: file.path)
        return value.lowercased()
      }
      let value = UUID().uuidString.lowercased()
      try value.write(to: file, atomically: true, encoding: .utf8)
      try file.setResourceValues(excluded)
      try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: file.path)
      return value
    } catch { return nil }
  }

  private func invalidate(cancelPermission: Bool = true) {
    generation += 1
    if let request = pending {
      request.retired = true
      request.promise?.resolve(result("error", code: "operation_invalidated"))
      request.promise = nil
      // Keep the gate until the callback; do not start another OS mutation.
    }
    if cancelPermission {
      permissionTimeout?.cancel()
      permissionTimeout = nil
      permissionPromise?.resolve(result("error", code: "permission_invalidated"))
      permissionPromise = nil
    }
  }
}

private final class PendingExport {
  let operation: ExportOperation
  let generation: Int
  var promise: Promise?
  var timeout: DispatchWorkItem?
  var offset = 0
  var acknowledged: [String] = []
  var failed = false
  var permissionMissing = false
  var retired = false
  init(operation: ExportOperation, promise: Promise, generation: Int) {
    self.operation = operation; self.promise = promise; self.generation = generation
  }
}

private struct ExportOperation {
  let type: String
  let category: String
  let clientId: String
  let revision: Double
  let start: Date
  let end: Date
  let values: [String: Double]

  static func parse(_ raw: [String: Any], nutrients: [(String, String, HKQuantityTypeIdentifier)]) -> ExportOperation? {
    guard let type = raw["type"] as? String, ["upsert", "delete"].contains(type),
          let category = raw["category"] as? String, ["nutrition", "workout"].contains(category),
          let clientId = raw["clientId"] as? String, clientId.count == 36, UUID(uuidString: clientId) != nil,
          let number = raw["revision"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite, number.doubleValue >= 1,
          number.doubleValue <= 9_007_199_254_740_991, number.doubleValue.rounded(.down) == number.doubleValue else { return nil }
    let start: Date
    let end: Date
    var values: [String: Double] = [:]
    if category == "nutrition" {
      guard let nutrition = raw["nutrition"] as? [String: Any], let date = date(nutrition["consumedAt"]) else { return nil }
      start = date; end = date
      for (component, field, _) in nutrients {
        guard let value = nutrition[field] else { return nil }
        if value is NSNull { continue }
        guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
              value.doubleValue.isFinite, value.doubleValue >= 0,
              value.doubleValue <= (component == "energy" ? 100_000 : 10_000) else { return nil }
        values[component] = value.doubleValue
      }
      if type == "upsert" && values.isEmpty { return nil }
    } else {
      guard let workout = raw["workout"] as? [String: Any],
            let first = date(workout["startedAt"]), let last = date(workout["endedAt"]),
            first < last, last.timeIntervalSince(first) <= 86_400 else { return nil }
      start = first; end = last
    }
    return ExportOperation(type: type, category: category, clientId: clientId.lowercased(),
      revision: number.doubleValue, start: start, end: end, values: values)
  }

  private static func date(_ raw: Any?) -> Date? {
    guard let raw = raw as? String, raw.count <= 40 else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: raw), date.timeIntervalSince1970.isFinite { return date }
    formatter.formatOptions = [.withInternetDateTime]
    guard let date = formatter.date(from: raw), date.timeIntervalSince1970.isFinite else { return nil }
    return date
  }
}
