import { describe, expect, it, vi } from "vitest";
import type { CompanionCommand, CompanionMessage } from "@mizyun/contracts";
import {
  WorkoutCompanionController,
  type CompanionOutcome,
  type CompanionWorkoutView,
} from "./controller";

const nonce = "11111111-1111-4111-8111-111111111111";
const binding = "22222222-2222-4222-8222-222222222222";
const workoutId = "33333333-3333-4333-8333-333333333333";
const operation = "44444444-4444-4444-8444-444444444444";
const view: CompanionWorkoutView = {
  workoutId,
  status: "active",
  exercise: {
    exerciseId: "planned-squat",
    name: "Squat",
    completedSets: 0,
    targetSets: 3,
    repetitions: 8,
    loadKg: 50,
    setType: "working",
    loadUnit: "kg",
  },
  restEndsAtMs: null,
  restDurationSeconds: null,
  canLogSet: true,
  canFinish: true,
};
async function setup(
  execute = vi.fn(async (): Promise<CompanionOutcome> => "saved"),
) {
  let now = 100_000;
  const published: CompanionMessage[] = [];
  const clear = vi.fn(async () => {});
  const status = vi.fn();
  const controller = new WorkoutCompanionController({
    uuid: () => binding,
    now: () => now,
    publish: async (message) => {
      published.push(message);
    },
    clear,
    execute,
    onStatus: status,
  });
  controller.update(view);
  controller.enable();
  await controller.receive(
    JSON.stringify({ protocolVersion: 1, kind: "hello", watchNonce: nonce }),
  );
  const snapshot = published.find((message) => message.kind === "snapshot")!;
  if (snapshot.kind !== "snapshot") throw new Error("missing snapshot");
  const command: CompanionCommand = {
    protocolVersion: 1,
    kind: "log-set",
    watchNonce: nonce,
    bindingId: binding,
    workoutId,
    operationId: operation,
    baseRevision: snapshot.revision,
    createdAtMs: now,
    expiresAtMs: now + 60_000,
    exerciseId: "planned-squat",
    repetitions: 8,
    loadKg: 50,
    setType: "working",
  };
  return {
    controller,
    published,
    clear,
    execute,
    status,
    command,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}
describe("phone-owned workout companion", () => {
  it("retires the previous valid lease when updated phone state cannot form a safe snapshot", async () => {
    const test = await setup();
    test.controller.update({
      ...view,
      exercise: { ...view.exercise!, name: "" },
    });
    await test.controller.receive(JSON.stringify(test.command));
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.clear).toHaveBeenCalled();
  });
  it("does not publish a workout without an explicit opt-in and watch hello", async () => {
    const publish = vi.fn(async () => {});
    const controller = new WorkoutCompanionController({
      uuid: () => binding,
      now: () => 100_000,
      publish,
      clear: async () => {},
      execute: async () => "saved",
      onStatus: () => {},
    });
    controller.update(view);
    await controller.receive(
      JSON.stringify({ protocolVersion: 1, kind: "hello", watchNonce: nonce }),
    );
    expect(publish).not.toHaveBeenCalled();
    controller.enable();
    await controller.refresh();
    expect(publish).not.toHaveBeenCalled();
  });
  it("replays saved receipts after a lost acknowledgement without repeating the mutation", async () => {
    const test = await setup();
    await test.controller.receive(JSON.stringify(test.command));
    await test.controller.receive(JSON.stringify(test.command));
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(
      test.published.filter((message) => message.kind === "ack").at(-1),
    ).toMatchObject({ status: "saved" });
  });
  it("locks uncertain outcomes across disconnect/reconnect in this session", async () => {
    const test = await setup(vi.fn(async () => "uncertain"));
    await test.controller.receive(JSON.stringify(test.command));
    test.controller.disable();
    expect(test.controller.enable()).toBe(false);
    await test.controller.receive(
      JSON.stringify({
        ...test.command,
        operationId: "55555555-5555-4555-8555-555555555555",
      }),
    );
    expect(test.execute).toHaveBeenCalledTimes(1);
  });
  it("rejects changed values under an already dispatched operation ID", async () => {
    const test = await setup();
    await test.controller.receive(JSON.stringify(test.command));
    await test.controller.receive(
      JSON.stringify({ ...test.command, repetitions: 9 }),
    );
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(test.published.at(-1)).toMatchObject({
      kind: "ack",
      reason: "invalid",
    });
  });
  it("invalidates commands when the phone's saved workout state changes", async () => {
    const test = await setup();
    test.controller.update({
      ...view,
      exercise: { ...view.exercise!, completedSets: 1 },
    });
    await test.controller.receive(JSON.stringify(test.command));
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.published.at(-1)).toMatchObject({
      kind: "ack",
      reason: "stale",
    });
  });
  it("does not reauthorize a retired account/foreground binding", async () => {
    const test = await setup();
    test.controller.disable();
    await test.controller.receive(JSON.stringify(test.command));
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.clear).toHaveBeenCalled();
  });
  it("blocks expired commands and new commands after completion", async () => {
    const test = await setup();
    test.advance(60_000);
    await test.controller.receive(JSON.stringify(test.command));
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.published.at(-1)).toMatchObject({ reason: "expired" });
    test.controller.update({
      ...view,
      status: "completed",
      canFinish: false,
      canLogSet: false,
    });
    await test.controller.receive(
      JSON.stringify({ ...test.command, expiresAtMs: 200_000 }),
    );
    expect(test.execute).not.toHaveBeenCalled();
  });
  it("retires a deferred outcome without publishing into a replacement account", async () => {
    let resolve!: (outcome: CompanionOutcome) => void;
    const test = await setup(
      vi.fn(
        () =>
          new Promise<CompanionOutcome>((done) => {
            resolve = done;
          }),
      ),
    );
    const pending = test.controller.receive(JSON.stringify(test.command));
    test.controller.disable();
    resolve("saved");
    await pending;
    expect(
      test.published.filter((message) => message.kind === "ack"),
    ).toHaveLength(0);
    expect(test.controller.enable()).toBe(false);
  });
  it("retains completed acknowledgement authority until the watch receives saved", async () => {
    const test = await setup(vi.fn(async () => "saved"));
    const finish = { ...test.command, kind: "finish" } as Record<
      string,
      unknown
    >;
    delete finish.exerciseId;
    delete finish.repetitions;
    delete finish.loadKg;
    delete finish.setType;
    await test.controller.receive(JSON.stringify(finish));
    test.controller.update({
      ...view,
      status: "completed",
      canLogSet: false,
      canFinish: false,
    });
    await test.controller.receive(JSON.stringify(finish));
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(test.published.at(-1)).toMatchObject({ status: "saved" });
  });
  it("rejects malformed, oversized, and unsolicited snapshot messages", async () => {
    const test = await setup();
    await test.controller.receive("{");
    await test.controller.receive("x".repeat(8193));
    await test.controller.receive(
      JSON.stringify({ ...test.command, accessToken: "forbidden" }),
    );
    expect(test.execute).not.toHaveBeenCalled();
  });
});
