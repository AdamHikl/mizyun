/**
 * Structured configuration issues returned by every loader.
 *
 * Each variant carries the data needed for a composition root to render an
 * actionable message: the offending key (or keys), the variant kind, and an
 * optional reason that names the rule that was violated. Loaders return
 * `readonly ConfigIssue[]` so the same envelope can carry one or many issues
 * without lossy collapsing.
 */
export type ConfigIssue =
  | { readonly kind: "missing"; readonly keys: readonly string[] }
  | {
      readonly kind: "malformed";
      readonly key: string;
      readonly reason: string;
    }
  | { readonly kind: "unexpected"; readonly keys: readonly string[] }
  | {
      readonly kind: "out_of_range";
      readonly key: string;
      readonly reason: string;
    };

/**
 * Stable, machine-readable issue codes so consumers (logs, UI surfaces, future
 * tooling) do not need to pattern-match on human-readable strings. Codes are
 * lower-snake-case and describe the category, not the message.
 */
export type ConfigIssueCode =
  | "config_missing"
  | "config_malformed"
  | "config_unexpected"
  | "config_out_of_range";

export const configIssueCode = (issue: ConfigIssue): ConfigIssueCode => {
  switch (issue.kind) {
    case "missing":
      return "config_missing";
    case "malformed":
      return "config_malformed";
    case "unexpected":
      return "config_unexpected";
    case "out_of_range":
      return "config_out_of_range";
  }
};

/**
 * Render an issue into a one-line description suitable for logs and UI.
 * Kept in this package so the loader never logs raw issues directly.
 */
export const formatConfigIssue = (issue: ConfigIssue): string => {
  switch (issue.kind) {
    case "missing":
      return `missing required key(s): ${issue.keys.join(", ")}`;
    case "malformed":
      return `${issue.key} is malformed: ${issue.reason}`;
    case "unexpected":
      return `unexpected key(s) in environment snapshot: ${issue.keys.join(", ")}`;
    case "out_of_range":
      return `${issue.key} is out of range: ${issue.reason}`;
  }
};
