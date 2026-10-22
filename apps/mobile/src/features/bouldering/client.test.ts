import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";

import {
  archiveBoulderProject,
  createBoulderAscent,
  getBoulderGradeSends,
  getBoulderProgress,
  listBoulderProjects,
  PROJECT_ALREADY_SENT_MESSAGE,
  setBoulderProjectArchived,
  toBoulderFailure,
} from "./client";
import {
  gradeSendsFixture,
  progressFixture,
  projectFixture,
} from "./progress-fixtures.test-support";

/** Fake client that parses the raw response with the route's schema, like the real one. */
const clientReturning = (
  raw: unknown,
): ApiClient & { request: ReturnType<typeof vi.fn> } =>
  ({
    status: () => ({ configured: true, baseUrl: "https://example.test" }),
    request: vi.fn(async (options: any) => {
      const parsed = options.schema.safeParse(raw);
      return parsed.success
        ? { ok: true, value: parsed.data }
        : {
            ok: false,
            error: { kind: "invalid_response", message: "bad shape" },
          };
    }),
  }) as any;

const failing = (status: number, code: string) =>
  ({
    status: () => ({ configured: true, baseUrl: "https://example.test" }),
    request: vi.fn(async () => ({
      ok: false,
      error: { kind: "http_error", status, code, message: code },
    })),
  }) as any;

describe("bouldering progress and project client", () => {
  it("requests one grade's sends with the grade URL-encoded", async () => {
    const client = clientReturning(
      gradeSendsFixture({ grade: "6A+", window: "30d" }),
    );
    const result = await getBoulderGradeSends("6A+", "30d", client);
    expect(client.request.mock.calls[0]![0]).toMatchObject({
      method: "GET",
      path: "/v1/bouldering/progress/grade?window=30d&grade=6A%2B",
    });
    expect(result.ok && result.value.sends).toHaveLength(3);
  });

  it("requests the chosen progress window and parses the response", async () => {
    const client = clientReturning(progressFixture({ window: "30d" }));
    const result = await getBoulderProgress("30d", client);
    expect(client.request.mock.calls[0]![0]).toMatchObject({
      method: "GET",
      path: "/v1/bouldering/progress?window=30d",
    });
    expect(result.ok && result.value.pyramid[1]).toEqual({
      grade: "6B",
      gradeRank: 7,
      sends: 7,
      flashes: 3,
    });
  });

  it("lists projects by status and unwraps the array", async () => {
    const project = projectFixture({ older: true });
    const client = clientReturning({ projects: [project] });
    const result = await listBoulderProjects("all", client);
    expect(client.request.mock.calls[0]![0].path).toBe(
      "/v1/bouldering/projects?status=all",
    );
    expect(result).toEqual({ ok: true, value: [project] });
  });

  it("rejects a project response with unknown fields", async () => {
    const client = clientReturning({
      projects: [{ ...projectFixture(), gymName: "x" }],
    });
    const result = await listBoulderProjects("open", client);
    expect(result.ok).toBe(false);
  });

  it("posts archive and reopen with the strict body", async () => {
    const archived = projectFixture({ status: "archived" });
    const client = clientReturning({ project: archived });
    const result = await setBoulderProjectArchived(archived.id, true, client);
    expect(client.request.mock.calls[0]![0]).toMatchObject({
      method: "POST",
      path: `/v1/bouldering/projects/${archived.id}/archive`,
      body: { archived: true },
    });
    expect(result).toEqual({ ok: true, value: archived });
    const reopen = await archiveBoulderProject(
      archived.id,
      false,
      clientReturning({ project: projectFixture() }),
    );
    expect(reopen).toEqual({ kind: "ok", project: projectFixture() });
  });

  it("reads a 409 on archive as an already sent project", async () => {
    const outcome = await archiveBoulderProject(
      projectFixture().id,
      true,
      failing(409, "CONFLICT"),
    );
    expect(outcome).toEqual({
      kind: "sent",
      message: PROJECT_ALREADY_SENT_MESSAGE,
    });
    const offline = await archiveBoulderProject(projectFixture().id, true, {
      status: () => ({}),
      request: async () => ({
        ok: false,
        error: { kind: "network_error", cause: null },
      }),
    } as any);
    expect(offline.kind === "error" && offline.failure.kind).toBe("offline");
  });

  it("maps BOULDER_PROJECT_UNAVAILABLE separately from a plain conflict", () => {
    expect(
      toBoulderFailure({
        kind: "http_error",
        status: 409,
        code: "BOULDER_PROJECT_UNAVAILABLE",
        message: "",
      }).kind,
    ).toBe("project_unavailable");
    expect(
      toBoulderFailure({
        kind: "http_error",
        status: 409,
        code: "CONFLICT",
        message: "",
      }).kind,
    ).toBe("conflict");
  });

  it("sends projectId on a linked create", async () => {
    const client = failing(500, "X");
    await createBoulderAscent(
      "33333333-3333-4333-8333-333333333333",
      {
        clientOperationId: "11111111-1111-4111-8111-111111111111",
        grade: "6B",
        result: "sent",
        attempts: 3,
        holdColour: null,
        note: null,
        photoAssetId: null,
        projectId: projectFixture().id,
      },
      client,
    );
    expect(client.request.mock.calls[0]![0].body.projectId).toBe(
      projectFixture().id,
    );
  });
});
