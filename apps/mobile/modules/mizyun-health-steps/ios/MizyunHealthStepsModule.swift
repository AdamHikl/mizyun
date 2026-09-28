import ExpoModulesCore
import HealthKit

public final class MizyunHealthStepsModule: Module {
  private let healthStore = HKHealthStore()

  public func definition() -> ModuleDefinition {
    Name("MizyunHealthSteps")

    AsyncFunction("getAvailability") { () -> String in
      HKHealthStore.isHealthDataAvailable() ? "available" : "unavailable"
    }

    AsyncFunction("requestReadPermission") { (promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable(),
            let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else {
        promise.resolve(false)
        return
      }

      // HealthKit does not disclose whether the user granted read access.
      // A successful callback means only that the request was processed.
      healthStore.requestAuthorization(toShare: [], read: [stepType]) { completed, error in
        promise.resolve(completed && error == nil)
      }
    }

    AsyncFunction("getDailySteps") { (startEpochMs: Double, endEpochMs: Double, promise: Promise) in
      guard startEpochMs.isFinite, endEpochMs.isFinite,
            startEpochMs < endEpochMs else {
        promise.reject("ERR_INVALID_STEP_RANGE", "Step date range must have a finite start before its end.")
        return
      }

      guard HKHealthStore.isHealthDataAvailable(),
            let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else {
        promise.resolve(nil)
        return
      }

      let startDate = Date(timeIntervalSince1970: startEpochMs / 1_000)
      let endDate = Date(timeIntervalSince1970: endEpochMs / 1_000)
      let predicate = HKQuery.predicateForSamples(
        withStart: startDate,
        end: endDate,
        options: []
      )
      let query = HKStatisticsQuery(
        quantityType: stepType,
        quantitySamplePredicate: predicate,
        options: .cumulativeSum
      ) { _, statistics, error in
        if let error {
          promise.reject(error)
          return
        }

        // An empty sum can mean no recorded samples or denied/limited read access.
        // HealthKit intentionally does not let an app distinguish those cases.
        let count = statistics?.sumQuantity()?.doubleValue(for: .count())
        promise.resolve(count.map { Int($0.rounded()) })
      }
      healthStore.execute(query)
    }
  }
}
