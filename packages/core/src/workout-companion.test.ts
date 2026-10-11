import { describe, expect, it } from "vitest";
import {
  COMPANION_MAX_RECEIPTS,
  WorkoutCompanionLedger,
  validateCompanionCommand,
  type CompanionAuthority,
  type CompanionCommandInput,
  type CompanionCommandDecision,
} from "./workout-companion.js";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const command = (
  overrides: Partial<CompanionCommandInput> = {},
): CompanionCommandInput =>
  ({
    protocolVersion: 1,
    kind: "log-set",
    watchNonce: uuid(1),
    bindingId: uuid(2),
    workoutId: uuid(3),
    operationId: uuid(4),
    baseRevision: 0,
    createdAtMs: 1_000,
    expiresAtMs: 121_000,
    exerciseId: "squat",
    repetitions: 8,
    loadKg: 80,
    setType: "working",
    ...overrides,
  }) as CompanionCommandInput;
const authority = (
  overrides: Partial<CompanionAuthority> = {},
): CompanionAuthority => ({
  watchNonce: uuid(1),
  bindingId: uuid(2),
  workoutId: uuid(3),
  revision: 0,
  issuedAtMs: 1_000,
  expiresAtMs: 121_000,
  status: "active",
  foreground: true,
  enabled: true,
  exerciseId: "squat",
  canLogSet: true,
  canFinish: true,
  canSkipRest: true,
  ...overrides,
});
const expectRejection = (decision: CompanionCommandDecision, reason: string) =>
  expect(decision).toMatchObject({
    kind: "ack",
    ack: { status: "rejected", reason },
  });
function setup() {
  let now = 1_000;
  const ledger = new WorkoutCompanionLedger(() => now);
  ledger.bind(authority());
  return {
    ledger,
    advance: (next: number) => {
      now = next;
    },
  };
}

describe("phone-owned workout companion authority", () => {
  it("replays a lost successful response without executing twice despite a newer revision", () => {
    const { ledger } = setup();
    const first = ledger.claim(command());
    expect(first.kind).toBe("execute");
    if (first.kind !== "execute") throw new Error("expected claim");
    const saved = ledger.settle(first.claim, "saved", 1);
    ledger.update(authority({ revision: 1 }));
    expect(ledger.claim(command())).toEqual({ kind: "ack", ack: saved });
    expectRejection(ledger.claim(command({ operationId: uuid(5) })), "stale");
  });
  it("replays a finish acknowledgement after completion", () => {
    const { ledger } = setup();
    const finish: CompanionCommandInput = {
      protocolVersion: 1,
      kind: "finish",
      watchNonce: uuid(1),
      bindingId: uuid(2),
      workoutId: uuid(3),
      operationId: uuid(4),
      baseRevision: 0,
      createdAtMs: 1_000,
      expiresAtMs: 121_000,
    };
    const first = ledger.claim(finish);
    if (first.kind !== "execute") throw new Error("expected claim");
    const saved = ledger.settle(first.claim, "saved", 1);
    ledger.update(authority({ status: "completed", revision: 1 }));
    expect(ledger.claim(finish)).toEqual({ kind: "ack", ack: saved });
    expectRejection(
      ledger.claim(command({ operationId: uuid(5), baseRevision: 1 })),
      "stale",
    );
  });
  it("rejects operation ID collision with changed performance or changed command type", () => {
    const { ledger } = setup();
    ledger.claim(command());
    expectRejection(ledger.claim(command({ repetitions: 9 })), "invalid");
    const {
      exerciseId: _exerciseId,
      repetitions: _repetitions,
      loadKg: _loadKg,
      setType: _setType,
      ...base
    } = command() as Extract<CompanionCommandInput, { kind: "log-set" }>;
    expectRejection(ledger.claim({ ...base, kind: "finish" }), "invalid");
  });
  it("serializes concurrent commands and marks an in-flight retry uncertain", () => {
    const { ledger } = setup();
    ledger.claim(command());
    expect(ledger.claim(command())).toMatchObject({
      kind: "ack",
      ack: { status: "uncertain", reason: "check-phone" },
    });
    expectRejection(ledger.claim(command({ operationId: uuid(5) })), "busy");
  });
  it("never automatically retries uncertain outcomes and blocks new commands until rotation", () => {
    const { ledger } = setup();
    const first = ledger.claim(command());
    if (first.kind !== "execute") throw new Error("expected claim");
    const uncertain = ledger.settle(first.claim, "uncertain", 0);
    expect(ledger.claim(command())).toEqual({ kind: "ack", ack: uncertain });
    expectRejection(
      ledger.claim(command({ operationId: uuid(5) })),
      "check-phone",
    );
    ledger.bind(authority({ bindingId: uuid(8) }));
    expect(
      ledger.claim(command({ bindingId: uuid(8), operationId: uuid(5) })).kind,
    ).toBe("execute");
  });
  it.each([{ baseRevision: 1 }, { exerciseId: "different" }])(
    "rejects out-of-order or mismatched exercise commands %j",
    (change) => {
      const { ledger } = setup();
      expectRejection(ledger.claim(command(change)), "stale");
    },
  );
  it.each([
    { status: "completed" as const },
    { status: "unavailable" as const },
    { canLogSet: false },
  ])("denies an inactive or disabled action %j", (change) => {
    const { ledger } = setup();
    ledger.update(authority(change));
    expectRejection(ledger.claim(command()), "stale");
  });
  it.each([
    { watchNonce: uuid(7) },
    { workoutId: uuid(7) },
    { foreground: false },
    { enabled: false },
  ])("retires authority on lifecycle changes %j", (change) => {
    const { ledger } = setup();
    const first = ledger.claim(command());
    if (first.kind !== "execute") throw new Error("expected claim");
    ledger.update(authority(change));
    expectRejection(ledger.claim(command()), "unbound");
    expect(ledger.settle(first.claim, "saved", 1)).toBeNull();
  });
  it("rejects old account/session commands after retirement and a fresh binding", () => {
    const { ledger } = setup();
    const first = ledger.claim(command());
    if (first.kind !== "execute") throw new Error("expected claim");
    ledger.retire();
    ledger.bind(authority({ bindingId: uuid(8) }));
    expectRejection(ledger.claim(command()), "unbound");
    expect(ledger.settle(first.claim, "saved", 1)).toBeNull();
    expect(ledger.claim(command({ bindingId: uuid(8) })).kind).toBe("execute");
  });
  it("fails closed after bounded receipts fill without evicting old deduplication evidence", () => {
    const { ledger } = setup();
    for (let n = 0; n < COMPANION_MAX_RECEIPTS; n++) {
      const first = ledger.claim(
        command({ operationId: uuid(n + 20), baseRevision: n }),
      );
      if (first.kind !== "execute") throw new Error("expected claim");
      ledger.settle(first.claim, "saved", n + 1);
      ledger.update(authority({ revision: n + 1 }));
    }
    expectRejection(
      ledger.claim(
        command({
          operationId: uuid(200),
          baseRevision: COMPANION_MAX_RECEIPTS,
        }),
      ),
      "busy",
    );
    expect(ledger.claim(command({ operationId: uuid(20) }))).toMatchObject({
      kind: "ack",
      ack: { status: "saved", revision: 1 },
    });
  });
  it("rejects expired commands and expired phone snapshots", () => {
    const { ledger, advance } = setup();
    advance(121_000);
    expectRejection(ledger.claim(command()), "expired");
    advance(2_000);
    ledger.update(authority({ expiresAtMs: 2_000 }));
    expectRejection(ledger.claim(command()), "expired");
  });
  it("allows at most ten seconds future clock skew and two minutes TTL", () => {
    expect(
      validateCompanionCommand(
        command({ createdAtMs: 11_000, expiresAtMs: 131_000 }),
        authority(),
        1_000,
      ),
    ).toBeNull();
    expect(
      validateCompanionCommand(
        command({ createdAtMs: 11_001, expiresAtMs: 131_001 }),
        authority(),
        1_000,
      ),
    ).toBe("invalid");
    expect(
      validateCompanionCommand(
        command({ expiresAtMs: 121_001 }),
        authority(),
        1_000,
      ),
    ).toBe("invalid");
    expect(
      validateCompanionCommand(
        command(),
        authority({ issuedAtMs: 11_001, expiresAtMs: 131_001 }),
        1_000,
      ),
    ).toBe("invalid");
  });
  it.each([
    { protocolVersion: 2 },
    { createdAtMs: NaN },
    { expiresAtMs: Infinity },
    { baseRevision: -1 },
    { repetitions: 1_001 },
    { loadKg: 2_001 },
    { operationId: "invalid" },
  ])("rejects malformed structural inputs %j", (change) => {
    const { ledger } = setup();
    expectRejection(
      ledger.claim(command(change as Partial<CompanionCommandInput>)),
      "invalid",
    );
  });
  it("denies rest and finish commands when the phone does not expose that action", () => {
    for (const kind of ["finish", "skip-rest"] as const) {
      const { ledger } = setup();
      ledger.update(authority({ canFinish: false, canSkipRest: false }));
      const {
        exerciseId: _exerciseId,
        repetitions: _repetitions,
        loadKg: _loadKg,
        setType: _setType,
        ...base
      } = command() as Extract<CompanionCommandInput, { kind: "log-set" }>;
      expectRejection(ledger.claim({ ...base, kind }), "stale");
    }
  });
});
