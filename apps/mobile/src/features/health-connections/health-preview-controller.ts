import {
  getHealthPreviewWindow,
  normalizeHealthPreviewRecords,
} from "@mizyun/core";
import type { HealthPreviewKind, HealthPreviewRecord } from "@mizyun/contracts";

export interface HealthPreviewPage {
  status:
    | "ready"
    | "unavailable"
    | "install_required"
    | "permission_required"
    | "error";
  records: unknown[];
  nextPageToken: string | null;
  readAccess: "unknown" | "granted";
  errorCode?: string;
}

export interface HealthPreviewReader {
  availabilityAsync(): Promise<HealthPreviewPage>;
  requestReadPermissionAsync(
    kind: HealthPreviewKind,
  ): Promise<HealthPreviewPage>;
  readPageAsync(
    kind: HealthPreviewKind,
    from: string,
    to: string,
    token: string | null,
  ): Promise<HealthPreviewPage>;
  invalidateAsync(): Promise<void>;
}

export interface HealthPreviewState {
  phase: "disabled" | "authorizing" | "reading" | "ready" | "partial" | "error";
  kind: HealthPreviewKind | null;
  records: HealthPreviewRecord[];
  message: string;
  from: string | null;
  to: string | null;
  lastReadAt: string | null;
}

const emptyState = (): HealthPreviewState => ({
  phase: "disabled",
  kind: null,
  records: [],
  message: "",
  from: null,
  to: null,
  lastReadAt: null,
});

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("health_preview_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function failureMessage(status: HealthPreviewPage["status"]): string {
  switch (status) {
    case "install_required":
      return "Install or update Health Connect, then try again.";
    case "permission_required":
      return "Read access is needed for this category. Check device health permissions, then try again.";
    case "unavailable":
      return "Health previews are unavailable on this device or build.";
    default:
      return "Could not read health records. Try again.";
  }
}

/** Ephemeral foreground session. It has no storage, analytics or network port. */
export class HealthPreviewController {
  private state = emptyState();
  private generation = 0;
  private active = true;
  private destroyed = false;
  private listeners = new Set<() => void>();
  private pendingRecords: unknown[] | null = null;
  constructor(
    private readonly reader: HealthPreviewReader,
    private readonly provider: "apple_health" | "health_connect",
    private readonly now: () => Date = () => new Date(),
    private readonly timeoutMs = 20000,
  ) {}

  getSnapshot = (): HealthPreviewState => this.state;
  attach = () => {
    this.destroyed = false;
  };
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(state: HealthPreviewState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  private current(generation: number) {
    return !this.destroyed && this.generation === generation;
  }
  private invalidateNative() {
    void this.reader.invalidateAsync().catch(() => undefined);
  }

  clear = () => {
    this.generation++;
    if (this.pendingRecords) this.pendingRecords.length = 0;
    this.pendingRecords = null;
    this.invalidateNative();
    this.publish(emptyState());
  };
  destroy = () => {
    this.destroyed = true;
    this.clear();
    this.listeners.clear();
  };
  setActive = (active: boolean) => {
    this.active = active;
    if (!active) {
      // A system permission dialog may temporarily deactivate the app. Keep only
      // that pending permission action; no preview data or paging session survives.
      if (this.state.phase === "authorizing") {
        this.publish({
          ...emptyState(),
          phase: "authorizing",
          kind: this.state.kind,
        });
      } else this.clear();
    }
  };

  async connect(kind: HealthPreviewKind): Promise<void> {
    if (
      this.destroyed ||
      !this.active ||
      this.state.phase === "reading" ||
      this.state.phase === "authorizing"
    )
      return;
    const generation = ++this.generation;
    this.publish({ ...emptyState(), phase: "authorizing", kind });
    try {
      const available = await withDeadline(
        this.reader.availabilityAsync(),
        this.timeoutMs,
      );
      if (!this.current(generation)) return;
      if (!this.active) {
        this.publish(emptyState());
        return;
      }
      if (available.status !== "ready") {
        this.publish({
          ...emptyState(),
          phase: "error",
          kind,
          message: failureMessage(available.status),
        });
        return;
      }
      const permission = await withDeadline(
        this.reader.requestReadPermissionAsync(kind),
        90000,
      );
      if (!this.current(generation)) return;
      if (permission.status !== "ready") {
        this.publish({
          ...emptyState(),
          phase: "error",
          kind,
          message: failureMessage(permission.status),
        });
        return;
      }
      if (!this.active) {
        this.publish({
          ...emptyState(),
          message:
            "Health access updated. Return here and choose a preview to read it.",
        });
        return;
      }
      await this.read(kind, generation);
    } catch {
      if (this.current(generation))
        this.publish({
          ...emptyState(),
          phase: "error",
          kind,
          message: failureMessage("error"),
        });
    }
  }

  async refresh(): Promise<void> {
    const kind = this.state.kind;
    if (
      !kind ||
      !this.active ||
      this.destroyed ||
      this.state.phase === "reading" ||
      this.state.phase === "authorizing"
    )
      return;
    await this.read(kind, ++this.generation);
  }

  private async read(
    kind: HealthPreviewKind,
    generation: number,
  ): Promise<void> {
    const window = getHealthPreviewWindow(this.now());
    this.publish({ ...emptyState(), ...window, phase: "reading", kind });
    const raw: unknown[] = [];
    this.pendingRecords = raw;
    const tokens = new Set<string>();
    let token: string | null = null;
    let partial = false;
    let unknownReadAccess = this.provider === "apple_health";
    try {
      for (let page = 0; page < 5; page++) {
        const result: HealthPreviewPage = await withDeadline(
          this.reader.readPageAsync(kind, window.from, window.to, token),
          this.timeoutMs,
        );
        if (!this.current(generation) || !this.active) return;
        if (result.status !== "ready") {
          if (raw.length === 0) {
            this.publish({
              ...emptyState(),
              ...window,
              phase: "error",
              kind,
              message: failureMessage(result.status),
            });
            return;
          }
          partial = true;
          break;
        }
        if (
          !Array.isArray(result.records) ||
          result.records.length > 100 ||
          (result.nextPageToken !== null &&
            (typeof result.nextPageToken !== "string" ||
              result.nextPageToken.length > 4096))
        )
          throw new Error("invalid_health_page");
        raw.push(...result.records);
        unknownReadAccess =
          unknownReadAccess || result.readAccess === "unknown";
        token = result.nextPageToken;
        if (token === null) break;
        if (tokens.has(token)) {
          partial = true;
          break;
        }
        tokens.add(token);
        if (page === 4) partial = true;
      }
      if (!this.current(generation) || !this.active) return;
      const normalized = normalizeHealthPreviewRecords({
        records: raw,
        kind,
        provider: this.provider,
        from: window.from,
        to: window.to,
      });
      partial = partial || normalized.rejectedCount > 0 || normalized.truncated;
      this.publish({
        phase: partial ? "partial" : "ready",
        kind,
        records: normalized.records,
        ...window,
        lastReadAt: this.now().toISOString(),
        message: partial
          ? "This preview is incomplete. Some records were unavailable, invalid, or beyond the 500-record limit. Refresh to try again."
          : normalized.records.length === 0
            ? unknownReadAccess
              ? "No readable records in this window. Apple Health may limit read access or have no matching records; this does not confirm a zero or permission denial."
              : "No readable records in this window. Health Connect may limit available history."
            : "Selected records currently readable in the requested window. Source apps and health permissions may limit coverage.",
      });
    } catch {
      if (!this.current(generation)) return;
      const normalized = normalizeHealthPreviewRecords({
        records: raw,
        kind,
        provider: this.provider,
        from: window.from,
        to: window.to,
      });
      this.publish({
        ...emptyState(),
        ...window,
        phase: raw.length ? "partial" : "error",
        kind,
        records: normalized.records,
        message: raw.length
          ? "This preview is incomplete because the read was interrupted. Refresh to try again."
          : failureMessage("error"),
      });
    } finally {
      raw.length = 0;
      if (this.pendingRecords === raw) this.pendingRecords = null;
      if (this.current(generation)) this.invalidateNative();
    }
  }
}
