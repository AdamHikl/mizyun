// Pure authorization result policy, also exercised by the bounded native check.
enum HealthExportAuthorizationPolicy {
  static func status(completed: Bool, failed: Bool, writeAccess: String) -> String {
    guard completed && !failed else { return "error" }
    switch writeAccess {
    case "granted": return "ready"
    case "partial": return "partial"
    default: return "permission_required"
    }
  }
}
