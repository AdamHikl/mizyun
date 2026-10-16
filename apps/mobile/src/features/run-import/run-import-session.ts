import type { RunImport, RunRecord } from "@mizyun/contracts";
import {
  buildRunImportCandidates,
  defaultSelection,
  toRunImport,
  type RunImportCandidate,
  type RunImportProvider,
} from "./run-import-candidates";

export interface RunImportPage {
  status:
    | "ready"
    | "unavailable"
    | "install_required"
    | "permission_required"
    | "error";
  records: unknown[];
  nextPageToken: string | null;
  readAccess: "unknown" | "granted";
}

export interface RunImportReader {
  availabilityAsync(): Promise<RunImportPage>;
  requestReadPermissionAsync(kind: "run"): Promise<RunImportPage>;
  readPageAsync(
    kind: "run",
    from: string,
    to: string,
    token: string | null,
  ): Promise<RunImportPage>;
  invalidateAsync(): Promise<void>;
}

export interface RunImportPorts {
  readonly reader: RunImportReader;
  readonly provider: RunImportProvider;
  /** Every run on or after `from` (YYYY-MM-DD), or null when it can't be read. */
  readonly loadExistingRuns: (from: string) => Promise<RunRecord[] | null>;
  readonly importRun: (
    body: RunImport,
  ) => Promise<
    | { ok: true; value: { run: RunRecord; created: boolean } }
    | { ok: false; message: string }
  >;
  readonly operationId: () => string;
  readonly deviceTimezone: () => string;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

export type RunImportOutcome = "added" | "existing" | "failed";

export interface RunImportState {
  phase:
    "idle" | "authorizing" | "reading" | "ready" | "saving" | "done" | "error";
  candidates: RunImportCandidate[];
  selected: ReadonlySet<string>;
  outcomes: ReadonlyMap<string, RunImportOutcome>;
  partial: boolean;
  message: string;
}

const WINDOW_DAYS = 30;
const MAX_PAGES = 5;
const idle = (message = ""): RunImportState => ({
  phase: "idle",
  candidates: [],
  selected: new Set(),
  outcomes: new Map(),
  partial: false,
  message,
});

function failureMessage(status: RunImportPage["status"]): string {
  switch (status) {
    case "install_required":
      return "Install or update Health Connect, then try again.";
    case "permission_required":
      return "Mizyun needs read access to workouts and distance. Check your device health permissions, then try again.";
    case "unavailable":
      return "Health import isn't available on this device or build.";
    default:
      return "Couldn't read runs from Health. Try again.";
  }
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("run_import_timeout")), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Foreground, in-memory import session. Health records are held only while the
 * screen is open and active; only the runs the user selects are sent.
 */
export class RunImportSession {
  private state = idle();
  private generation = 0;
  private destroyed = false;
  private active = true;
  private listeners = new Set<() => void>();
  // Stable per record so a retried save after a lost response is idempotent.
  private operations = new Map<string, string>();
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(private readonly ports: RunImportPorts) {
    this.now = ports.now ?? (() => new Date());
    this.timeoutMs = ports.timeoutMs ?? 20000;
  }

  getSnapshot = (): RunImportState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(state: RunImportState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  private current(generation: number) {
    return !this.destroyed && generation === this.generation;
  }
  private invalidateNative() {
    void this.ports.reader.invalidateAsync().catch(() => undefined);
  }

  clear = (message = "") => {
    this.generation++;
    this.operations.clear();
    this.invalidateNative();
    this.publish(idle(message));
  };
  destroy = () => {
    this.clear();
    this.destroyed = true;
    this.listeners.clear();
  };
  /** Backgrounding discards read records unless a permission sheet or save is open. */
  setActive = (active: boolean) => {
    this.active = active;
    if (active) return;
    if (this.state.phase === "authorizing" || this.state.phase === "saving")
      return;
    if (this.state.phase !== "idle") this.clear();
  };

  toggle = (key: string) => {
    if (this.state.phase !== "ready") return;
    const candidate = this.state.candidates.find((c) => c.key === key);
    if (!candidate || candidate.alreadyImported) return;
    if (this.state.outcomes.get(key) === "added") return;
    const selected = new Set(this.state.selected);
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    this.publish({ ...this.state, selected });
  };

  async read(): Promise<void> {
    if (
      this.destroyed ||
      ["authorizing", "reading", "saving"].includes(this.state.phase)
    )
      return;
    const generation = ++this.generation;
    this.operations.clear();
    this.publish({ ...idle(), phase: "authorizing" });
    const fail = (message: string) => {
      if (this.current(generation))
        this.publish({ ...idle(), phase: "error", message });
    };
    try {
      const available = await withDeadline(
        this.ports.reader.availabilityAsync(),
        this.timeoutMs,
      );
      if (!this.current(generation)) return;
      if (available.status !== "ready")
        return fail(failureMessage(available.status));
      const permission = await withDeadline(
        this.ports.reader.requestReadPermissionAsync("run"),
        90000,
      );
      if (!this.current(generation)) return;
      if (permission.status !== "ready")
        return fail(failureMessage(permission.status));
      this.publish({ ...idle(), phase: "reading" });
      const now = this.now();
      const from = new Date(now.getTime() - WINDOW_DAYS * 86400000);
      const records: unknown[] = [];
      let token: string | null = null;
      let partial = false;
      const tokens = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page++) {
        const result: RunImportPage = await withDeadline(
          this.ports.reader.readPageAsync(
            "run",
            from.toISOString(),
            now.toISOString(),
            token,
          ),
          this.timeoutMs,
        );
        if (!this.current(generation)) return;
        if (result.status !== "ready") {
          if (!records.length) return fail(failureMessage(result.status));
          partial = true;
          break;
        }
        if (!Array.isArray(result.records) || result.records.length > 100)
          return fail(failureMessage("error"));
        records.push(...result.records);
        token = result.nextPageToken;
        if (token === null) break;
        if (tokens.has(token) || page === MAX_PAGES - 1) {
          partial = true;
          break;
        }
        tokens.add(token);
      }
      this.invalidateNative();
      // A day earlier than the window covers runs dated in other timezones.
      const existing = await this.ports.loadExistingRuns(
        new Date(from.getTime() - 86400000).toISOString().slice(0, 10),
      );
      if (!this.current(generation)) return;
      if (existing === null)
        return fail(
          "Couldn't check your existing runs, so duplicates can't be detected. Try again when online.",
        );
      const built = buildRunImportCandidates({
        records,
        provider: this.ports.provider,
        deviceTimezone: this.ports.deviceTimezone(),
        existingRuns: existing,
        now,
      });
      records.length = 0;
      partial = partial || built.rejectedCount > 0;
      this.publish({
        phase: "ready",
        candidates: built.candidates,
        selected: defaultSelection(built.candidates),
        outcomes: new Map(),
        partial,
        message: built.candidates.length
          ? ""
          : this.ports.provider === "apple_health"
            ? "No runs found in the last 30 days. Apple Health may also hide data Mizyun can't read."
            : "No runs found in the last 30 days.",
      });
      // A read that finished in the background must not keep records in memory.
      if (!this.active) this.clear();
    } catch {
      fail(failureMessage("error"));
    }
  }

  /** Saves selected runs one by one; failures stay selected for Retry. */
  async save(): Promise<void> {
    if (this.state.phase !== "ready" || this.state.selected.size === 0) return;
    const generation = this.generation;
    const chosen = this.state.candidates.filter((c) =>
      this.state.selected.has(c.key),
    );
    const outcomes = new Map(this.state.outcomes);
    this.publish({ ...this.state, phase: "saving", message: "" });
    for (const candidate of chosen) {
      let operation = this.operations.get(candidate.key);
      if (!operation) {
        operation = this.ports.operationId();
        this.operations.set(candidate.key, operation);
      }
      const body = toRunImport(candidate, operation);
      let outcome: RunImportOutcome = "failed";
      if (body) {
        try {
          const result = await this.ports.importRun(body);
          if (result.ok) outcome = result.value.created ? "added" : "existing";
        } catch {
          outcome = "failed";
        }
      }
      if (!this.current(generation)) return;
      outcomes.set(candidate.key, outcome);
      this.publish({ ...this.state, outcomes });
    }
    const failed = chosen.filter((c) => outcomes.get(c.key) === "failed");
    this.publish({
      ...this.state,
      phase: failed.length ? "ready" : "done",
      selected: new Set(failed.map((c) => c.key)),
      outcomes,
      message: failed.length
        ? `${failed.length} ${failed.length === 1 ? "run" : "runs"} couldn't be added. Check your connection and try again.`
        : "",
    });
    // A save that finished in the background must not leave records in memory.
    if (!this.active) this.clear();
  }
}
