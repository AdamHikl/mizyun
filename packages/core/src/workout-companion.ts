/** In-memory, phone-owned authority for a manual workout companion. No transport or persistence. */
export const COMPANION_MAX_TTL_MS = 120_000;
export const COMPANION_MAX_CLOCK_SKEW_MS = 10_000;
export const COMPANION_MAX_RECEIPTS = 64;

type SetType = "warmup" | "working" | "drop" | "failure";
interface CommandBase {
  readonly protocolVersion: 1;
  readonly watchNonce: string;
  readonly bindingId: string;
  readonly workoutId: string;
  readonly operationId: string;
  readonly baseRevision: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}
export type CompanionCommandInput = CommandBase &
  (
    | {
        readonly kind: "log-set";
        readonly exerciseId: string;
        readonly repetitions: number;
        readonly loadKg: number;
        readonly setType: SetType;
      }
    | { readonly kind: "finish" | "skip-rest" }
  );
export interface CompanionAuthority {
  readonly watchNonce: string;
  readonly bindingId: string;
  readonly workoutId: string;
  readonly revision: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: "active" | "completed" | "unavailable";
  readonly foreground: boolean;
  readonly enabled: boolean;
  readonly exerciseId?: string;
  readonly canLogSet: boolean;
  readonly canFinish: boolean;
  readonly canSkipRest: boolean;
}
export interface CompanionCommandReceipt {
  readonly protocolVersion: 1;
  readonly kind: "ack";
  readonly watchNonce: string;
  readonly bindingId: string;
  readonly operationId: string;
  readonly status: "saved" | "rejected" | "uncertain";
  readonly reason:
    | "saved"
    | "stale"
    | "expired"
    | "busy"
    | "unbound"
    | "invalid"
    | "check-phone";
  readonly revision: number;
}
export interface CompanionClaim {
  readonly command: CompanionCommandInput;
  readonly token: number;
}
export type CompanionCommandDecision =
  | { readonly kind: "execute"; readonly claim: CompanionClaim }
  | { readonly kind: "ack"; readonly ack: CompanionCommandReceipt };

type RejectionReason = Exclude<CompanionCommandReceipt["reason"], "saved">;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validInteger = (value: number) =>
  Number.isSafeInteger(value) && value >= 0;
const validWindow = (start: number, end: number, now: number) =>
  validInteger(start) &&
  validInteger(end) &&
  end >= start &&
  end - start <= COMPANION_MAX_TTL_MS &&
  start <= now + COMPANION_MAX_CLOCK_SKEW_MS;
const matchesAuthority = (
  command: CompanionCommandInput,
  authority: CompanionAuthority | null,
) =>
  authority !== null &&
  authority.foreground &&
  authority.enabled &&
  command.watchNonce === authority.watchNonce &&
  command.bindingId === authority.bindingId &&
  command.workoutId === authority.workoutId;
const validCommand = (command: CompanionCommandInput) =>
  command.protocolVersion === 1 &&
  [
    command.watchNonce,
    command.bindingId,
    command.workoutId,
    command.operationId,
  ].every((value) => typeof value === "string" && uuidPattern.test(value)) &&
  validInteger(command.baseRevision) &&
  (command.kind === "finish" ||
    command.kind === "skip-rest" ||
    (command.kind === "log-set" &&
      typeof command.exerciseId === "string" &&
      command.exerciseId.length > 0 &&
      command.exerciseId.length <= 100 &&
      validInteger(command.repetitions) &&
      command.repetitions <= 1_000 &&
      Number.isFinite(command.loadKg) &&
      command.loadKg >= 0 &&
      command.loadKg <= 2_000 &&
      ["warmup", "working", "drop", "failure"].includes(command.setType)));

/** Mutable session checks for a NEW operation; completed receipts are replayed separately. */
export const validateCompanionCommand = (
  command: CompanionCommandInput,
  authority: CompanionAuthority | null,
  nowMs: number,
): RejectionReason | null => {
  if (!validCommand(command) || !validInteger(nowMs)) return "invalid";
  if (!matchesAuthority(command, authority) || !authority) return "unbound";
  if (
    !validInteger(authority.revision) ||
    !validWindow(command.createdAtMs, command.expiresAtMs, nowMs) ||
    !validWindow(authority.issuedAtMs, authority.expiresAtMs, nowMs)
  )
    return "invalid";
  if (nowMs >= command.expiresAtMs || nowMs >= authority.expiresAtMs)
    return "expired";
  if (
    authority.status !== "active" ||
    command.baseRevision !== authority.revision
  )
    return "stale";
  if (
    command.kind === "log-set" &&
    (!authority.canLogSet || command.exerciseId !== authority.exerciseId)
  )
    return "stale";
  if (command.kind === "finish" && !authority.canFinish) return "stale";
  if (command.kind === "skip-rest" && !authority.canSkipRest) return "stale";
  return null;
};

const fingerprint = (command: CompanionCommandInput) =>
  JSON.stringify([
    command.protocolVersion,
    command.kind,
    command.watchNonce,
    command.bindingId,
    command.workoutId,
    command.operationId,
    command.baseRevision,
    command.createdAtMs,
    command.expiresAtMs,
    ...(command.kind === "log-set"
      ? [
          command.exerciseId,
          command.repetitions,
          command.loadKg,
          command.setType,
        ]
      : []),
  ]);
interface LedgerEntry {
  fingerprint: string;
  claim: CompanionClaim;
  receipt: CompanionCommandReceipt;
}

export class WorkoutCompanionLedger {
  private authority: CompanionAuthority | null = null;
  private readonly receipts = new Map<string, LedgerEntry>();
  private inFlight: CompanionClaim | null = null;
  private nextToken = 0;
  private uncertain = false;
  constructor(private readonly clock: () => number = Date.now) {}

  /** The caller supplies a fresh random binding per foreground/account/workout/watch session. */
  bind(authority: CompanionAuthority): void {
    if (this.authority?.bindingId === authority.bindingId) {
      this.update(authority);
      return;
    }
    this.retire();
    this.authority = { ...authority };
  }
  /** A nonce/workout switch retires all old authority. It must be followed by a fresh bind. */
  update(authority: CompanionAuthority): void {
    if (
      !this.authority ||
      authority.bindingId !== this.authority.bindingId ||
      authority.watchNonce !== this.authority.watchNonce ||
      authority.workoutId !== this.authority.workoutId ||
      !authority.foreground ||
      !authority.enabled ||
      authority.revision < this.authority.revision
    ) {
      this.retire();
      return;
    }
    this.authority = { ...authority };
  }
  retire(): void {
    this.authority = null;
    this.receipts.clear();
    this.inFlight = null;
    this.uncertain = false;
  }
  private ack(
    command: CompanionCommandInput,
    reason: RejectionReason,
  ): CompanionCommandReceipt {
    return {
      protocolVersion: 1,
      kind: "ack",
      watchNonce: command.watchNonce,
      bindingId: command.bindingId,
      operationId: command.operationId,
      status: "rejected",
      reason,
      revision: this.authority?.revision ?? 0,
    };
  }
  claim(command: CompanionCommandInput): CompanionCommandDecision {
    if (!validCommand(command))
      return { kind: "ack", ack: this.ack(command, "invalid") };
    if (!matchesAuthority(command, this.authority))
      return { kind: "ack", ack: this.ack(command, "unbound") };
    const prior = this.receipts.get(command.operationId);
    if (prior)
      return {
        kind: "ack",
        ack:
          prior.fingerprint === fingerprint(command)
            ? { ...prior.receipt }
            : this.ack(command, "invalid"),
      };
    const reason = validateCompanionCommand(
      command,
      this.authority,
      this.clock(),
    );
    if (reason) return { kind: "ack", ack: this.ack(command, reason) };
    if (this.uncertain)
      return { kind: "ack", ack: this.ack(command, "check-phone") };
    if (this.inFlight || this.receipts.size >= COMPANION_MAX_RECEIPTS)
      return { kind: "ack", ack: this.ack(command, "busy") };
    const claim: CompanionClaim = Object.freeze({
      command: Object.freeze({ ...command }),
      token: ++this.nextToken,
    });
    const receipt: CompanionCommandReceipt = {
      ...this.ack(command, "check-phone"),
      status: "uncertain",
    };
    // Claim before dispatch: a lost response or abandoned execution can never re-execute this ID.
    this.receipts.set(command.operationId, {
      fingerprint: fingerprint(command),
      claim,
      receipt,
    });
    this.inFlight = claim;
    return { kind: "execute", claim };
  }
  settle(
    claim: CompanionClaim,
    outcome: "saved" | "rejected" | "uncertain",
    revision: number,
  ): CompanionCommandReceipt | null {
    const entry = this.receipts.get(claim.command.operationId);
    if (
      !entry ||
      entry.claim !== claim ||
      this.inFlight !== claim ||
      !matchesAuthority(claim.command, this.authority) ||
      !validInteger(revision)
    )
      return null;
    entry.receipt = {
      ...entry.receipt,
      status: outcome,
      reason: outcome === "saved" ? "saved" : "check-phone",
      revision,
    };
    this.inFlight = null;
    this.uncertain = outcome === "uncertain";
    return { ...entry.receipt };
  }
}
