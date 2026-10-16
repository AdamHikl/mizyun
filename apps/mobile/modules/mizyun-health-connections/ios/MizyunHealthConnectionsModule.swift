import ExpoModulesCore
import HealthKit
import UIKit

public final class MizyunHealthConnectionsModule: Module {
  private let healthStore = HKHealthStore()
  // All mutable state is confined to the main queue. Nothing is persisted.
  private var generation = 0
  private var sessions: [String: PageSession] = [:]
  private var pendingRead: PendingRead?
  private var permissionPending = false
  private var permissionPromise: Promise?
  private var permissionTimeout: DispatchWorkItem?
  private let ownSources: Set<String> = [
    "com.mizyun.app", "com.mizyun.development", "com.mizyun.dev"
  ]

  public func definition() -> ModuleDefinition {
    Name("MizyunHealthConnections")

    AsyncFunction("availabilityAsync") { () -> [String: Any] in
      self.result(HKHealthStore.isHealthDataAvailable() ? "ready" : "unavailable")
    }.runOnQueue(.main)

    AsyncFunction("requestReadPermissionAsync") { [self] (kind: String, promise: Promise) in
      guard let type = self.sampleType(kind) else {
        promise.resolve(self.result("error", code: "invalid_kind")); return
      }
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve(self.result("unavailable")); return
      }
      guard UIApplication.shared.applicationState == .active else {
        promise.resolve(self.result("error", code: "foreground_required")); return
      }
      guard !self.permissionPending else {
        promise.resolve(self.result("error", code: "permission_busy")); return
      }
      self.permissionPending = true
      self.permissionPromise = promise
      let timeout = DispatchWorkItem { [weak self] in
        guard let self else { return }
        self.permissionPromise?.resolve(self.result("error", code: "permission_timeout"))
        self.permissionPromise = nil
        self.permissionTimeout = nil
        // The system sheet cannot be cancelled. Keep the launch gate closed until
        // its callback arrives so a late result cannot settle a newer request.
      }
      self.permissionTimeout = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: timeout)
      self.healthStore.requestAuthorization(toShare: [], read: self.readTypes(kind, type)) { [weak self] completed, error in
        DispatchQueue.main.async {
          guard let self else { return }
          self.permissionTimeout?.cancel()
          self.permissionTimeout = nil
          self.permissionPending = false
          // HealthKit never reveals a read grant, including after this callback.
          self.permissionPromise?.resolve(self.result(
            completed && error == nil ? "ready" : "error",
            code: completed && error == nil ? nil : "permission_request_failed"
          ))
          self.permissionPromise = nil
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("readPageAsync") {
      (kind: String, fromISO: String, toISO: String, token: String?, promise: Promise) in
      self.readPage(kind, fromISO, toISO, token, promise)
    }.runOnQueue(.main)

    AsyncFunction("invalidateAsync") { () in self.invalidate() }.runOnQueue(.main)
    OnAppEntersBackground { self.invalidateOnMain(cancelPermission: false) }
    OnDestroy { self.invalidateOnMain() }
  }

  private func sampleType(_ kind: String) -> HKSampleType? {
    switch kind {
    case "weight": return HKObjectType.quantityType(forIdentifier: .bodyMass)
    case "workout", "run": return HKObjectType.workoutType()
    default: return nil
    }
  }

  /// Read types requested for one kind. Runs add only walking/running distance,
  /// used for workout statistics; no routes, heart rate or energy are requested.
  private func readTypes(_ kind: String, _ type: HKSampleType) -> Set<HKObjectType> {
    kind == "run" ? [type, HKQuantityType(.distanceWalkingRunning)] : [type]
  }

  private func predicate(_ kind: String, _ from: Date, _ to: Date) -> NSPredicate {
    let window = HKQuery.predicateForSamples(withStart: from, end: to, options: [.strictStartDate])
    guard kind == "run" else { return window }
    // Filter in HealthKit so the 1,001-sample limit applies to running workouts only.
    return NSCompoundPredicate(andPredicateWithSubpredicates: [
      window, HKQuery.predicateForWorkouts(with: .running)
    ])
  }

  private func result(
    _ status: String,
    records: [[String: Any]] = [],
    token: String? = nil,
    code: String? = nil
  ) -> [String: Any] {
    var value: [String: Any] = [
      "status": status, "records": records,
      "nextPageToken": token as Any? ?? NSNull(), "readAccess": "unknown"
    ]
    if let code { value["errorCode"] = code }
    return value
  }

  private func parseISO(_ value: String) -> Date? {
    guard value.count <= 40 else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
  }

  private func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    return formatter.string(from: date)
  }

  private func readPage(
    _ kind: String, _ fromISO: String, _ toISO: String,
    _ token: String?, _ promise: Promise
  ) {
    guard let type = sampleType(kind) else {
      promise.resolve(result("error", code: "invalid_kind")); return
    }
    guard let from = parseISO(fromISO), let to = parseISO(toISO),
          from < to, to.timeIntervalSince(from) <= 30 * 24 * 60 * 60,
          from.timeIntervalSince1970.isFinite, to.timeIntervalSince1970.isFinite else {
      promise.resolve(result("error", code: "invalid_range")); return
    }
    guard HKHealthStore.isHealthDataAvailable() else {
      promise.resolve(result("unavailable")); return
    }
    guard UIApplication.shared.applicationState == .active else {
      promise.resolve(result("error", code: "foreground_required")); return
    }
    let now = Date()
    sessions = sessions.filter { $0.value.expiresAt > now }
    if let token {
      guard token.count <= 64, let session = sessions.removeValue(forKey: token),
            session.kind == kind, session.from == from, session.to == to else {
        promise.resolve(result("error", code: "invalid_page_token")); return
      }
      promise.resolve(page(session)); return
    }
    guard pendingRead == nil else {
      promise.resolve(result("error", code: "read_busy")); return
    }
    let requestGeneration = generation
    let samplePredicate = predicate(kind, from, to)
    let query = HKSampleQuery(
      sampleType: type, predicate: samplePredicate, limit: 1_001,
      sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
    ) { [weak self] query, samples, error in
      DispatchQueue.main.async {
        guard let self, let pending = self.pendingRead,
              pending.query === query, self.generation == requestGeneration else { return }
        pending.timeout.cancel()
        self.pendingRead = nil
        guard UIApplication.shared.applicationState == .active else {
          promise.resolve(self.result("error", code: "foreground_required")); return
        }
        guard error == nil else {
          promise.resolve(self.result("error", code: "read_failed")); return
        }
        let samples = samples ?? []
        guard samples.count <= 1_000 else {
          // Never represent a capped snapshot as complete source coverage.
          promise.resolve(self.result("error", code: "source_limit_exceeded")); return
        }
        let ordered = samples.sorted {
          $0.startDate == $1.startDate
            ? $0.uuid.uuidString < $1.uuid.uuidString : $0.startDate > $1.startDate
        }
        let records = ordered.compactMap { self.record($0, kind, from, to) }
        let session = PageSession(
          kind: kind, from: from, to: to, records: records, offset: 0,
          expiresAt: Date().addingTimeInterval(300)
        )
        promise.resolve(self.page(session))
      }
    }
    let timeout = DispatchWorkItem { [weak self] in
      guard let self, let pending = self.pendingRead, pending.query === query else { return }
      self.healthStore.stop(query)
      self.pendingRead = nil
      promise.resolve(self.result("error", code: "read_timeout"))
    }
    pendingRead = PendingRead(query: query, promise: promise, timeout: timeout)
    DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
    healthStore.execute(query)
  }

  private func page(_ session: PageSession) -> [String: Any] {
    let end = min(session.offset + 100, session.records.count)
    let records = Array(session.records[session.offset..<end])
    var next: String?
    if end < session.records.count {
      // At most four snapshots, each at most 1,000 filtered records.
      if sessions.count >= 4,
         let oldest = sessions.min(by: { $0.value.expiresAt < $1.value.expiresAt })?.key {
        sessions.removeValue(forKey: oldest)
      }
      var continuation = session
      continuation.offset = end
      next = UUID().uuidString
      sessions[next!] = continuation
    }
    return result("ready", records: records, token: next)
  }

  private func record(_ sample: HKSample, _ kind: String, _ from: Date, _ to: Date) -> [String: Any]? {
    let source = sample.sourceRevision.source
    guard !ownSources.contains(source.bundleIdentifier), !source.bundleIdentifier.isEmpty,
          sample.startDate >= from, sample.startDate < to else { return nil }
    // Only whitelisted metadata keys are read (timezone; indoor for runs); no full metadata crosses JS.
    let timeZone = (sample.metadata?[HKMetadataKeyTimeZone] as? String)
      .flatMap { TimeZone(identifier: $0)?.identifier }
    var value: [String: Any] = [
      "kind": kind, "provider": "apple_health", "externalId": sample.uuid.uuidString,
      "sourceAppId": source.bundleIdentifier,
      "sourceAppName": source.name.isEmpty ? NSNull() : source.name as Any,
      "sourceTimeZone": timeZone as Any? ?? NSNull()
    ]
    if kind == "weight", let sample = sample as? HKQuantitySample {
      let kg = sample.quantity.doubleValue(for: .gramUnit(with: .kilo))
      guard kg.isFinite, kg > 0 else { return nil }
      value["measuredAt"] = iso(sample.startDate)
      value["weightKg"] = kg
    } else if kind == "workout", let workout = sample as? HKWorkout, completed(workout, to) {
      value["startedAt"] = iso(workout.startDate)
      value["endedAt"] = iso(workout.endDate)
      value["activityType"] = activityName(workout.workoutActivityType)
      value["durationSeconds"] = workout.duration
    } else if kind == "run", let workout = sample as? HKWorkout,
              workout.workoutActivityType == .running, completed(workout, to) {
      value["startedAt"] = iso(workout.startDate)
      value["endedAt"] = iso(workout.endDate)
      value["durationSeconds"] = workout.duration
      value["durationBasis"] = "active"
      value["distanceMeters"] = distanceMeters(workout) as Any? ?? NSNull()
      // Only the indoor flag is read in addition to the timezone key.
      value["indoor"] = (workout.metadata?[HKMetadataKeyIndoorWorkout] as? Bool) as Any? ?? NSNull()
    } else { return nil }
    return value
  }

  private func completed(_ workout: HKWorkout, _ to: Date) -> Bool {
    workout.endDate > workout.startDate && workout.endDate <= to &&
      workout.duration.isFinite && workout.duration >= 0 &&
      workout.duration <= workout.endDate.timeIntervalSince(workout.startDate)
  }

  /// Workout statistics (iOS 16+, the module's floor is 16.4) rather than the
  /// deprecated `totalDistance`. Missing or non-positive sums stay unavailable.
  private func distanceMeters(_ workout: HKWorkout) -> Double? {
    guard let sum = workout.statistics(for: HKQuantityType(.distanceWalkingRunning))?.sumQuantity()
    else { return nil }
    let meters = sum.doubleValue(for: .meter())
    return meters.isFinite && meters > 0 ? meters : nil
  }

  private func activityName(_ type: HKWorkoutActivityType) -> String {
    switch type {
    case .walking: return "Walking"
    case .running: return "Running"
    case .cycling: return "Cycling"
    case .swimming: return "Swimming"
    case .traditionalStrengthTraining, .functionalStrengthTraining: return "Strength training"
    case .yoga: return "Yoga"
    case .pilates: return "Pilates"
    case .hiking: return "Hiking"
    case .rowing: return "Rowing"
    case .elliptical: return "Elliptical"
    case .stairClimbing: return "Stair climbing"
    case .highIntensityIntervalTraining: return "Interval training"
    case .dance, .cardioDance, .socialDance: return "Dance"
    case .tennis: return "Tennis"
    case .basketball: return "Basketball"
    case .soccer: return "Soccer"
    default: return "Other workout"
    }
  }

  private func invalidateOnMain(cancelPermission: Bool = true) {
    if Thread.isMainThread { invalidate(cancelPermission: cancelPermission) }
    else { DispatchQueue.main.async { [weak self] in self?.invalidate(cancelPermission: cancelPermission) } }
  }

  private func invalidate(cancelPermission: Bool = true) {
    generation += 1
    sessions.removeAll()
    if let pending = pendingRead {
      pending.timeout.cancel()
      healthStore.stop(pending.query)
      pendingRead = nil
      pending.promise.resolve(result("error", code: "read_invalidated"))
    }
    if cancelPermission {
      permissionTimeout?.cancel()
      permissionTimeout = nil
      permissionPromise?.resolve(result("error", code: "permission_invalidated"))
      permissionPromise = nil
    }
  }
}

private struct PageSession {
  let kind: String
  let from: Date
  let to: Date
  let records: [[String: Any]]
  var offset: Int
  let expiresAt: Date
}

private struct PendingRead {
  let query: HKSampleQuery
  let promise: Promise
  let timeout: DispatchWorkItem
}
