import { describe, expect, it } from "vitest";
import {
  companionAckSchema,
  companionClearSchema,
  companionCommandSchema,
  companionHelloSchema,
  companionMessageSchema,
  companionSnapshotSchema,
} from "./workout-companion.js";
const id = "00000000-0000-4000-8000-000000000001";
const command = {
  protocolVersion: 1,
  kind: "log-set",
  watchNonce: id,
  bindingId: id,
  workoutId: id,
  operationId: id,
  baseRevision: 0,
  createdAtMs: 1_000,
  expiresAtMs: 121_000,
  exerciseId: "squat",
  repetitions: 8,
  loadKg: 80,
  setType: "working",
};
const snapshot = {
  protocolVersion: 1,
  kind: "snapshot",
  watchNonce: id,
  bindingId: id,
  workoutId: id,
  revision: 0,
  issuedAtMs: 1_000,
  expiresAtMs: 121_000,
  status: "active",
  exercise: {
    exerciseId: "squat",
    name: "Squat",
    completedSets: 0,
    targetSets: 3,
    repetitions: 8,
    loadKg: 80,
    setType: "working",
    loadUnit: "kg",
  },
  restEndsAtMs: null,
  restDurationSeconds: null,
  canLogSet: true,
  canFinish: true,
};

describe("workout companion v1 wire boundary", () => {
  it("parses the manual snapshot and all three command kinds", () => {
    expect(companionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(companionCommandSchema.parse(command)).toEqual(command);
    const {
      exerciseId: _exerciseId,
      repetitions: _repetitions,
      loadKg: _loadKg,
      setType: _setType,
      ...base
    } = command;
    for (const kind of ["finish", "skip-rest"])
      expect(companionCommandSchema.parse({ ...base, kind }).kind).toBe(kind);
  });
  it("accepts hello, acknowledgement and nonce-scoped clear messages", () => {
    const messages = [
      { protocolVersion: 1, kind: "hello", watchNonce: id },
      {
        protocolVersion: 1,
        kind: "ack",
        watchNonce: id,
        bindingId: id,
        operationId: id,
        status: "uncertain",
        reason: "check-phone",
        revision: 1,
      },
      { protocolVersion: 1, kind: "clear", reason: "inactive", watchNonce: id },
      { protocolVersion: 1, kind: "clear", reason: "disconnected" },
    ];
    messages.forEach((message) =>
      expect(companionMessageSchema.parse(message)).toEqual(message),
    );
  });
  it.each(["userId", "auth", "notes", "history", "sensors"])(
    "rejects extra snapshot field %s",
    (field) => {
      expect(
        companionSnapshotSchema.safeParse({ ...snapshot, [field]: "secret" })
          .success,
      ).toBe(false);
    },
  );
  it("rejects unknown keys at every message and exercise boundary", () => {
    expect(
      companionSnapshotSchema.safeParse({
        ...snapshot,
        exercise: { ...snapshot.exercise, notes: "private" },
      }).success,
    ).toBe(false);
    expect(
      companionCommandSchema.safeParse({ ...command, extra: true }).success,
    ).toBe(false);
    expect(
      companionHelloSchema.safeParse({
        protocolVersion: 1,
        kind: "hello",
        watchNonce: id,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      companionClearSchema.safeParse({
        protocolVersion: 1,
        kind: "clear",
        reason: "inactive",
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      companionAckSchema.safeParse({
        protocolVersion: 1,
        kind: "ack",
        watchNonce: id,
        bindingId: id,
        operationId: id,
        status: "saved",
        reason: "saved",
        revision: 1,
        extra: true,
      }).success,
    ).toBe(false);
  });
  it.each([
    { expiresAtMs: 121_001 },
    { expiresAtMs: 999 },
    { createdAtMs: Infinity },
    { createdAtMs: 1.5 },
    { baseRevision: -1 },
    { protocolVersion: 2 },
    { operationId: "not-uuid" },
    { repetitions: 1_001 },
    { repetitions: 1.5 },
    { loadKg: 2_001 },
    { loadKg: NaN },
    { setType: "normal" },
    { exerciseId: "x".repeat(101) },
  ])("rejects malformed or excessive commands %j", (invalid) => {
    expect(
      companionCommandSchema.safeParse({ ...command, ...invalid }).success,
    ).toBe(false);
  });
  it("bounds snapshots, allows null performance values and unavailable status", () => {
    expect(
      companionSnapshotSchema.safeParse({ ...snapshot, expiresAtMs: 121_001 })
        .success,
    ).toBe(false);
    expect(
      companionSnapshotSchema.safeParse({ ...snapshot, expiresAtMs: 999 })
        .success,
    ).toBe(false);
    expect(
      companionSnapshotSchema.safeParse({
        ...snapshot,
        exercise: { ...snapshot.exercise, name: "x".repeat(121) },
      }).success,
    ).toBe(false);
    expect(
      companionSnapshotSchema.safeParse({
        ...snapshot,
        status: "unavailable",
        exercise: null,
        canLogSet: false,
        canFinish: false,
      }).success,
    ).toBe(true);
    expect(
      companionSnapshotSchema.safeParse({
        ...snapshot,
        exercise: { ...snapshot.exercise, repetitions: null, loadKg: null },
      }).success,
    ).toBe(true);
  });
});
