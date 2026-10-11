import {
  companionMessageSchema,
  companionSnapshotSchema,
  type CompanionCommand,
  type CompanionMessage,
  type CompanionSnapshot,
} from "@mizyun/contracts";
import { WorkoutCompanionLedger } from "@mizyun/core";

export type CompanionWorkoutView = Pick<
  CompanionSnapshot,
  | "workoutId"
  | "status"
  | "exercise"
  | "restEndsAtMs"
  | "restDurationSeconds"
  | "canLogSet"
  | "canFinish"
>;
export type CompanionOutcome = "saved" | "rejected" | "uncertain";
export interface CompanionControllerPorts {
  uuid(): string;
  now(): number;
  publish(message: CompanionMessage): Promise<void>;
  clear(): Promise<void>;
  execute(command: CompanionCommand): Promise<CompanionOutcome>;
  onStatus(status: string): void;
  onRetired?(): void;
}

/** Authority is intentionally ephemeral. Restart/blur/logout requires another opt-in. */
export class WorkoutCompanionController {
  private readonly ledger: WorkoutCompanionLedger;
  private enabled = false;
  private view: CompanionWorkoutView | null = null;
  private nonce: string | null = null;
  private binding: string | null = null;
  private revision = 0;
  private inFlight = false;
  private uncertain = false;
  private generation = 0;

  constructor(private readonly ports: CompanionControllerPorts) {
    this.ledger = new WorkoutCompanionLedger(ports.now);
  }

  update(view: CompanionWorkoutView | null): void {
    if (this.view?.workoutId && this.view.workoutId !== view?.workoutId)
      this.disable();
    if (JSON.stringify(this.view) !== JSON.stringify(view)) this.revision++;
    this.view = view;
    if (this.enabled) void this.refresh();
  }

  enable(): boolean {
    if (!this.view || this.view.status !== "active" || this.uncertain) {
      if (this.uncertain)
        this.ports.onStatus(
          "Check your phone. Watch controls stay paused for this session after an uncertain save.",
        );
      return false;
    }
    this.enabled = true;
    this.ports.onStatus(
      "Open Mizyun on your watch. Keep this workout open on your phone.",
    );
    return true;
  }

  disable(): void {
    this.generation++;
    this.enabled = false;
    this.nonce = null;
    this.binding = null;
    this.inFlight = false;
    this.ledger.retire();
    this.ports.onRetired?.();
    void this.ports.clear().catch(() => undefined);
  }

  async refresh(): Promise<void> {
    const snapshot = this.snapshot();
    if (!snapshot) return;
    this.ledger.update(this.authority(snapshot));
    await this.send(snapshot);
  }

  async receive(json: string): Promise<void> {
    if (json.length > 8192 || !this.enabled || !this.view) return;
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return;
    }
    const parsed = companionMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.kind === "hello") {
      if (this.inFlight || this.uncertain || this.view.status !== "active")
        return;
      if (this.nonce !== message.watchNonce) {
        this.generation++;
        this.nonce = message.watchNonce;
        this.binding = this.ports.uuid();
        const snapshot = this.snapshot();
        if (!snapshot) return;
        this.ledger.bind(this.authority(snapshot));
      }
      this.ports.onStatus(
        "Watch connected. Controls pause when you leave this workout.",
      );
      await this.refresh();
      return;
    }
    if (
      message.kind !== "log-set" &&
      message.kind !== "finish" &&
      message.kind !== "skip-rest"
    )
      return;
    const claim = this.ledger.claim(message);
    if (claim.kind === "ack") {
      await this.send(claim.ack);
      return;
    }
    this.inFlight = true;
    // Retiring a foreground binding must not erase a possibly committed mutation.
    this.uncertain = true;
    const generation = this.generation;
    let outcome: CompanionOutcome;
    try {
      outcome = await this.ports.execute(message);
    } catch {
      outcome = "uncertain";
    }
    if (generation !== this.generation) return;
    this.inFlight = false;
    this.revision++;
    this.uncertain = outcome === "uncertain";
    const ack = this.ledger.settle(claim.claim, outcome, this.revision);
    if (ack) await this.send(ack);
    this.ports.onStatus(
      this.uncertain
        ? "Check the saved workout on your phone. Watch controls are paused; this command will not be repeated."
        : outcome === "saved"
          ? "Saved. Watch is up to date."
          : "Action unavailable. Check your phone.",
    );
    await this.refresh();
  }

  private snapshot(): CompanionSnapshot | null {
    if (!this.enabled || !this.view || !this.nonce || !this.binding)
      return null;
    const now = this.ports.now();
    const parsed = companionSnapshotSchema.safeParse({
      ...this.view,
      protocolVersion: 1,
      kind: "snapshot",
      watchNonce: this.nonce,
      bindingId: this.binding,
      revision: this.revision,
      issuedAtMs: now,
      expiresAtMs: now + 90_000,
      canLogSet: this.view.canLogSet && !this.uncertain,
      canFinish: this.view.canFinish && !this.uncertain,
    });
    if (!parsed.success) {
      this.disable();
      this.ports.onStatus(
        "This workout needs phone logging. Watch controls are unavailable.",
      );
      return null;
    }
    return parsed.data;
  }

  private authority(snapshot: CompanionSnapshot) {
    return {
      ...snapshot,
      foreground: true,
      enabled: this.enabled,
      exerciseId: snapshot.exercise?.exerciseId,
      canSkipRest: snapshot.restEndsAtMs !== null && !this.uncertain,
    };
  }

  private async send(message: CompanionMessage): Promise<void> {
    try {
      await this.ports.publish(message);
    } catch {
      this.ports.onStatus(
        "Watch connection interrupted. Reopen Mizyun on your watch.",
      );
    }
  }
}
