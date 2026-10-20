import ExpoModulesCore
#if canImport(FoundationModels)
import FoundationModels
#endif

/// One string field the model fills, such as an activity name.
struct OnDeviceField: Record {
  @Field var name: String = ""
  @Field var description: String = ""
}

public final class MizyunOnDeviceLlmModule: Module {
  /// A session warmed for the next request with the same instructions.
  /// Typed as Any so the module still loads before iOS 26.
  private var warmed: (instructions: String, session: Any)?
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("MizyunOnDeviceLlm")

    // Founder diagnostics: only the Dev app shows how long generation took.
    Constant("showsTimings") { () -> Bool in
      Bundle.main.bundleIdentifier == "com.mizyun.development"
    }

    AsyncFunction("getAvailability") { () -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
          return "available"
        case .unavailable(.deviceNotEligible):
          return "device_not_eligible"
        case .unavailable(.appleIntelligenceNotEnabled):
          return "apple_intelligence_disabled"
        case .unavailable(.modelNotReady):
          return "model_not_ready"
        case .unavailable:
          return "unavailable"
        }
      }
      #endif
      return "unsupported"
    }

    AsyncFunction("prewarm") { (instructions: String) in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        guard case .available = SystemLanguageModel.default.availability else { return }
        let session = LanguageModelSession(model: SystemLanguageModel.default, instructions: instructions)
        session.prewarm()
        self.lock.withLock { self.warmed = (instructions, session) }
      }
      #endif
    }

    // Fills each field with a string through guided generation, so the
    // model cannot answer outside the requested shape. Each call uses a
    // fresh session: nothing from one description reaches the next.
    AsyncFunction("generateFields") {
      (instructions: String, prompt: String, fields: [OnDeviceField], maximumResponseTokens: Int, timeoutMs: Int) async throws -> [String: String] in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        guard !fields.isEmpty else {
          throw Exception(name: "ERR_ON_DEVICE_FIELDS", description: "At least one field is required.")
        }
        guard case .available = SystemLanguageModel.default.availability else {
          throw Exception(name: "ERR_ON_DEVICE_UNAVAILABLE", description: "The on-device model is not available.")
        }
        let session = self.takeSession(instructions: instructions)
        let root = DynamicGenerationSchema(
          name: "Answer",
          properties: fields.map {
            DynamicGenerationSchema.Property(
              name: $0.name,
              description: $0.description,
              schema: DynamicGenerationSchema(type: String.self)
            )
          }
        )
        let schema = try GenerationSchema(root: root, dependencies: [])
        let options = GenerationOptions(
          samplingMode: .greedy,
          maximumResponseTokens: max(1, min(maximumResponseTokens, 512))
        )
        let names = fields.map(\.name)
        let timeout = UInt64(max(100, min(timeoutMs, 30_000))) * 1_000_000
        // The first task to finish wins; the other is cancelled, so a slow
        // generation does not keep running after the caller gave up.
        return try await withThrowingTaskGroup(of: [String: String].self) { group in
          group.addTask {
            let response = try await session.respond(to: prompt, schema: schema, options: options)
            var values: [String: String] = [:]
            for name in names {
              values[name] = try response.content.value(String.self, forProperty: name)
            }
            return values
          }
          group.addTask {
            try await Task.sleep(nanoseconds: timeout)
            throw Exception(name: "ERR_ON_DEVICE_TIMEOUT", description: "On-device generation timed out.")
          }
          defer { group.cancelAll() }
          guard let values = try await group.next() else {
            throw Exception(name: "ERR_ON_DEVICE_TIMEOUT", description: "On-device generation timed out.")
          }
          return values
        }
      }
      #endif
      throw Exception(name: "ERR_ON_DEVICE_UNSUPPORTED", description: "On-device generation needs iOS 26 or later.")
    }
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  private func takeSession(instructions: String) -> LanguageModelSession {
    lock.withLock {
      defer { warmed = nil }
      if let warmed, warmed.instructions == instructions,
         let session = warmed.session as? LanguageModelSession {
        return session
      }
      return LanguageModelSession(model: SystemLanguageModel.default, instructions: instructions)
    }
  }
  #endif
}
