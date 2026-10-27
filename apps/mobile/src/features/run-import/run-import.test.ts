import { describe, expect, it, vi } from "vitest";
import type { RunImport, RunRecord } from "@mizyun/contracts";
import {
  buildRunImportCandidates,
  defaultSelection,
  toRunImport,
} from "./run-import-candidates";
import {
  RunImportSession,
  type RunImportPage,
  type RunImportReader,
} from "./run-import-session";

const now = new Date("2026-10-16T12:00:00.000Z");
const USER = "7d1f9a6e-35a6-4f61-9d5b-64ae7c0f8a11";
const healthRun = (patch: Record<string, unknown> = {}) => ({
  kind: "run",
  provider: "apple_health",
  externalId: "hk-1",
  sourceAppId: "com.example.watch",
  sourceAppName: "Synthetic Watch",
  sourceTimeZone: "Europe/Bratislava",
  startedAt: "2026-10-15T05:00:00.000Z",
  endedAt: "2026-10-15T05:31:00.000Z",
  durationSeconds: 1800.4,
  durationBasis: "active",
  distanceMeters: 5012.345,
  indoor: false,
  ...patch,
});
const storedRun = (
  summary: Partial<RunRecord["summary"]>,
  id = "11111111-1111-4111-8111-111111111111",
): RunRecord => ({
  id,
  userId: USER,
  clientOperationId: "22222222-2222-4222-8222-222222222222",
  name: "Run",
  notes: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  summary: {
    version: 1,
    activityDate: "2026-10-15",
    recordingTimezone: "Europe/Bratislava",
    timePrecision: "instant",
    startedAt: "2026-10-15T05:10:00.000Z",
    durationSeconds: 1200,
    durationBasis: "elapsed",
    distanceMeters: null,
    environment: "unspecified",
    perceivedExertion: null,
    origin: { kind: "manual" },
    timestampEnvelope: "observed",
    revision: 1,
    ...summary,
  } as RunRecord["summary"],
});
const build = (records: unknown[], existingRuns: RunRecord[] = []) =>
  buildRunImportCandidates({
    records,
    provider: "apple_health",
    deviceTimezone: "UTC",
    existingRuns,
    now,
  });

describe("run import candidates", () => {
  it("keeps provider facts, rounds to contract precision and maps indoor", () => {
    const { candidates, rejectedCount } = build([healthRun()]);
    expect(rejectedCount).toBe(0);
    expect(candidates[0]).toMatchObject({
      activityDate: "2026-10-15",
      recordingTimezone: "Europe/Bratislava",
      durationSeconds: 1800,
      durationBasis: "active",
      distanceMeters: 5012.35,
      environment: "outdoor",
      alreadyImported: false,
      possibleDuplicate: false,
    });
    expect(
      build([healthRun()], [storedRun({})]).candidates[0]?.possibleDuplicate,
    ).toBe(true);
    const body = toRunImport(
      candidates[0]!,
      "33333333-3333-4333-8333-333333333333",
    );
    expect(body).toMatchObject({
      provider: "apple_health",
      externalId: "hk-1",
      sourceAppId: "com.example.watch",
      startedAt: "2026-10-15T05:00:00.000Z",
    });
  });

  it("uses the source timezone for the date, falling back to the device", () => {
    const late = {
      startedAt: "2026-10-14T22:30:00.000Z",
      endedAt: "2026-10-14T23:00:00.000Z",
    };
    expect(build([healthRun(late)]).candidates[0]?.activityDate).toBe(
      "2026-10-15",
    );
    expect(
      build([healthRun({ ...late, sourceTimeZone: null })]).candidates[0]
        ?.activityDate,
    ).toBe("2026-10-14");
  });

  it("never invents distance and rejects malformed records", () => {
    const { candidates, rejectedCount } = build([
      healthRun({ distanceMeters: null, externalId: "a" }),
      healthRun({ distanceMeters: 0, externalId: "b" }),
      healthRun({ kind: "workout", externalId: "c" }),
      healthRun({ provider: "health_connect", externalId: "d" }),
      healthRun({ durationSeconds: 99999, externalId: "e" }),
      healthRun({ endedAt: "2026-10-17T00:00:00.000Z", externalId: "f" }),
      healthRun({ durationBasis: "moving", externalId: "g" }),
      healthRun({ externalId: "" }),
      healthRun({ durationSeconds: 4000, externalId: "h" }),
    ]);
    expect(candidates.map((c) => [c.externalId, c.distanceMeters])).toEqual([
      ["a", null],
      ["b", null],
    ]);
    expect(rejectedCount).toBe(7);
  });

  it("flags a Health candidate that overlaps a file-imported run", () => {
    const fileRun = storedRun({
      startedAt: "2026-10-15T05:05:00.000Z",
      durationSeconds: 1800,
      durationBasis: "elapsed",
      origin: { kind: "file_import", format: "strava", externalId: "999" },
    });
    const [candidate] = build([healthRun()], [fileRun]).candidates;
    expect(candidate).toMatchObject({
      alreadyImported: false,
      possibleDuplicate: true,
    });
  });

  it("marks exact re-imports and flags overlapping or date-only runs", () => {
    const imported = storedRun({
      startedAt: "2026-10-15T05:00:00.000Z",
      durationSeconds: 1800,
      durationBasis: "active",
      origin: {
        kind: "health_import",
        provider: "apple_health",
        sourceAppId: "com.example.watch",
        sourceAppName: "Synthetic Watch",
        externalId: "hk-1",
      },
    });
    const [same] = build([healthRun()], [imported]).candidates;
    expect(same).toMatchObject({
      alreadyImported: true,
      possibleDuplicate: false,
    });

    const dateOnly = storedRun({
      activityDate: "2026-10-12",
      timePrecision: "day",
      startedAt: null,
      timestampEnvelope: "date_anchor",
    });
    const records = [
      healthRun({
        externalId: "x",
        startedAt: "2026-10-12T06:00:00.000Z",
        endedAt: "2026-10-12T06:30:00.000Z",
      }),
      healthRun({
        externalId: "y",
        startedAt: "2026-10-13T06:00:00.000Z",
        endedAt: "2026-10-13T06:30:00.000Z",
      }),
    ];
    const { candidates } = build(records, [dateOnly]);
    expect(candidates.map((c) => [c.externalId, c.possibleDuplicate])).toEqual([
      ["y", false],
      ["x", true],
    ]);
    expect([...defaultSelection(candidates)]).toEqual([candidates[0]!.key]);
  });
});

function setup(
  pages: RunImportPage[],
  existing: RunRecord[] | null = [],
  importRun = vi.fn(async (body: RunImport) => ({
    ok: true as const,
    value: { run: storedRun({}), created: body.externalId !== "dup" },
  })),
) {
  const reader: RunImportReader = {
    availabilityAsync: vi.fn(async () => page([])),
    requestReadPermissionAsync: vi.fn(async () => page([])),
    readPageAsync: vi.fn(async () => pages.shift() ?? page([])),
    invalidateAsync: vi.fn(async () => undefined),
  };
  let n = 0;
  const session = new RunImportSession({
    reader,
    provider: "apple_health",
    loadExistingRuns: vi.fn(async () => existing),
    importRun,
    operationId: () => `44444444-4444-4444-8444-44444444444${n++}`,
    deviceTimezone: () => "UTC",
    now: () => now,
  });
  return { session, reader, importRun };
}
const page = (
  records: unknown[],
  nextPageToken: string | null = null,
): RunImportPage => ({
  status: "ready",
  records,
  nextPageToken,
  readAccess: "unknown",
});

describe("run import review regressions", () => {
  it.each(["+02:00", "Z", "GMT+0200", "UTC+2", "posix/Europe/Paris"])(
    "replaces unstorable source zone %s with the device zone",
    (sourceTimeZone) => {
      const [candidate] = buildRunImportCandidates({
        records: [healthRun({ provider: "health_connect", sourceTimeZone })],
        provider: "health_connect",
        deviceTimezone: "Europe/Prague",
        existingRuns: [],
        now,
      }).candidates;
      expect(candidate?.recordingTimezone).toBe("Europe/Prague");
      expect(
        toRunImport(candidate!, "33333333-3333-4333-8333-333333333333"),
      ).not.toBeNull();
    },
  );

  it("flags the same run copied into Health by two apps", () => {
    const { candidates } = build([
      healthRun({ externalId: "watch" }),
      healthRun({
        externalId: "strava",
        sourceAppId: "com.example.strava",
        startedAt: "2026-10-15T05:00:30.000Z",
      }),
      healthRun({
        externalId: "other-day",
        startedAt: "2026-10-13T05:00:00.000Z",
        endedAt: "2026-10-13T05:31:00.000Z",
      }),
    ]);
    expect(
      Object.fromEntries(
        candidates.map((c) => [c.externalId, c.possibleDuplicate]),
      ),
    ).toEqual({ watch: true, strava: true, "other-day": false });
    expect(defaultSelection(candidates).size).toBe(1);
  });
});

describe("run import session", () => {
  it("requests run access, reads pages and preselects new runs", async () => {
    const { session, reader } = setup([
      page([healthRun({ externalId: "a" })], "t1"),
      page([
        healthRun({
          externalId: "b",
          startedAt: "2026-10-14T05:00:00.000Z",
          endedAt: "2026-10-14T05:31:00.000Z",
        }),
      ]),
    ]);
    await session.read();
    expect(reader.requestReadPermissionAsync).toHaveBeenCalledWith("run");
    const state = session.getSnapshot();
    expect(state.phase).toBe("ready");
    expect(state.candidates).toHaveLength(2);
    expect(state.selected.size).toBe(2);
    expect(reader.invalidateAsync).toHaveBeenCalled();
  });

  it("refuses to list when existing runs can't be checked for duplicates", async () => {
    const { session } = setup([page([healthRun()])], null);
    await session.read();
    expect(session.getSnapshot()).toMatchObject({
      phase: "error",
      candidates: [],
    });
  });

  it("reports permission failures without records", async () => {
    const { session, reader } = setup([]);
    vi.mocked(reader.requestReadPermissionAsync).mockResolvedValueOnce({
      ...page([]),
      status: "permission_required",
    });
    await session.read();
    expect(session.getSnapshot().phase).toBe("error");
    expect(reader.readPageAsync).not.toHaveBeenCalled();
  });

  it("clears read records when backgrounded, but not while saving", async () => {
    const { session } = setup([page([healthRun({ externalId: "a" })])]);
    await session.read();
    session.setActive(false);
    expect(session.getSnapshot()).toMatchObject({
      phase: "idle",
      candidates: [],
    });
  });

  it("saves only selected runs and retries failures with the same operation", async () => {
    const importRun = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "offline" })
      .mockResolvedValue({
        ok: true,
        value: { run: storedRun({}), created: true },
      });
    const { session } = setup(
      [
        page([
          healthRun({ externalId: "a" }),
          healthRun({
            externalId: "b",
            startedAt: "2026-10-14T05:00:00.000Z",
            endedAt: "2026-10-14T05:31:00.000Z",
          }),
        ]),
      ],
      [],
      importRun,
    );
    await session.read();
    const [first, second] = session.getSnapshot().candidates;
    session.toggle(second!.key);
    await session.save();
    expect(importRun).toHaveBeenCalledTimes(1);
    const firstOperation = importRun.mock.calls[0]![0].clientOperationId;
    expect(session.getSnapshot()).toMatchObject({ phase: "ready" });
    expect([...session.getSnapshot().selected]).toEqual([first!.key]);
    await session.save();
    expect(importRun.mock.calls[1]![0].clientOperationId).toBe(firstOperation);
    expect(session.getSnapshot().phase).toBe("done");
    expect(session.getSnapshot().outcomes.get(first!.key)).toBe("added");
  });

  it("drops late results after clear", async () => {
    let release: (value: RunImportPage) => void = () => undefined;
    const { session, reader } = setup([]);
    vi.mocked(reader.readPageAsync).mockReturnValueOnce(
      new Promise((resolve) => (release = resolve)),
    );
    const reading = session.read();
    await vi.waitFor(() => expect(reader.readPageAsync).toHaveBeenCalled());
    session.clear();
    release(page([healthRun()]));
    await reading;
    expect(session.getSnapshot()).toMatchObject({
      phase: "idle",
      candidates: [],
    });
  });

  it("clears records when a save finishes after backgrounding", async () => {
    let release: () => void = () => undefined;
    const importRun = vi.fn(
      () =>
        new Promise<{
          ok: true;
          value: { run: RunRecord; created: boolean };
        }>((resolve) => {
          release = () =>
            resolve({ ok: true, value: { run: storedRun({}), created: true } });
        }),
    );
    const { session } = setup([page([healthRun()])], [], importRun);
    await session.read();
    const saving = session.save();
    session.setActive(false);
    expect(session.getSnapshot().phase).toBe("saving");
    release();
    await saving;
    expect(session.getSnapshot()).toMatchObject({
      phase: "idle",
      candidates: [],
    });
  });

  it("clears records when a read finishes after backgrounding", async () => {
    const { session, reader } = setup([page([healthRun()])]);
    let grant: (value: RunImportPage) => void = () => undefined;
    vi.mocked(reader.requestReadPermissionAsync).mockReturnValueOnce(
      new Promise((resolve) => (grant = resolve)),
    );
    const reading = session.read();
    await vi.waitFor(() =>
      expect(reader.requestReadPermissionAsync).toHaveBeenCalled(),
    );
    session.setActive(false);
    grant(page([]));
    await reading;
    expect(session.getSnapshot()).toMatchObject({
      phase: "idle",
      candidates: [],
    });
  });
});
