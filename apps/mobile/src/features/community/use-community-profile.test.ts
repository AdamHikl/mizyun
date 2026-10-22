import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@mizyun/api-client";
import type { AuthSession } from "@mizyun/identity";
import { CommunityProfileController } from "./use-community-profile";
import { CommunityReadCache } from "./state/read-cache";

describe("CommunityProfileController", () => {
  const mockNow = () => new Date("2026-09-29T12:00:00Z");

  it("evaluates adult eligibility fail-closed (denies < 18 or missing birth year)", () => {
    const client = { request: vi.fn() } as unknown as ApiClient;

    const minorController = new CommunityProfileController({
      client,
      birthYear: 2012, // 14 years old
      now: mockNow,
      autoLoad: false,
    });
    expect(minorController.getState().isAdultEligible).toBe(false);

    const missingYearController = new CommunityProfileController({
      client,
      birthYear: null,
      now: mockNow,
      autoLoad: false,
    });
    expect(missingYearController.getState().isAdultEligible).toBe(false);

    const adultController = new CommunityProfileController({
      client,
      birthYear: 1995, // 31 years old
      now: mockNow,
      autoLoad: false,
    });
    expect(adultController.getState().isAdultEligible).toBe(true);
  });

  it("handles unenrolled state when profile returns 404 COMMUNITY_NOT_ENROLLED", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        kind: "http_error",
        status: 404,
        code: "COMMUNITY_NOT_ENROLLED",
        message: "Not enrolled",
      },
    });
    const client = { request } as unknown as ApiClient;

    const controller = new CommunityProfileController({
      client,
      birthYear: 1995,
      now: mockNow,
      autoLoad: false,
    });

    await controller.load();
    const state = controller.getState();
    expect(state.status).toBe("ready");
    expect(state.profile).toBeNull();
    expect(state.isEnrolled).toBe(false);
    expect(state.error).toBeNull();
  });

  it("treats not-enrolled as unenrolled after the read cache retires the failed read", async () => {
    // The read cache clears itself on a failed read and reports the server
    // error as the cause of a retired read; a withdrawn account hit this on
    // every Community tab visit.
    const raw = {
      request: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          kind: "http_error",
          status: 404,
          code: "COMMUNITY_NOT_ENROLLED",
          message: "Not enrolled",
        },
      }),
      status: () => ({ configured: true, baseUrl: "https://x.invalid" }),
    } as unknown as ApiClient;
    const cache = new CommunityReadCache(
      raw,
      async () =>
        ({
          user: { id: "alice" },
          accessToken: "alice-token",
        }) as AuthSession,
    );
    cache.setPrincipal("alice");
    cache.setForeground(true);
    const controller = new CommunityProfileController({
      client: cache,
      principalKey: "alice",
      birthYear: 1995,
      now: mockNow,
      autoLoad: false,
    });

    await controller.load();
    const state = controller.getState();
    cache.dispose();
    expect(state.status).toBe("ready");
    expect(state.isEnrolled).toBe(false);
    expect(state.error).toBeNull();
  });

  it("sets active enrolled profile upon successful fetch", async () => {
    const mockProfile = {
      userId: "u-1",
      handle: "alex_fit",
      displayName: "Alex Fit",
      avatarSymbol: "AF",
      bio: null,
      isSearchable: true,
      status: "active" as const,
      generation: 1,
      createdAt: "2026-09-29T10:00:00Z",
      updatedAt: "2026-09-29T10:00:00Z",
    };
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: mockProfile,
    });
    const client = { request } as unknown as ApiClient;

    const controller = new CommunityProfileController({
      client,
      birthYear: 1995,
      now: mockNow,
      autoLoad: false,
    });

    await controller.load();
    const state = controller.getState();
    expect(state.status).toBe("ready");
    expect(state.profile).toEqual(mockProfile);
    expect(state.isEnrolled).toBe(true);
    expect(state.isWithdrawn).toBe(false);
  });

  it("blocks enrollment client-side if user is not confirmed adult", async () => {
    const request = vi.fn();
    const client = { request } as unknown as ApiClient;

    const controller = new CommunityProfileController({
      client,
      birthYear: 2015, // minor
      now: mockNow,
      autoLoad: false,
    });

    const result = await controller.enroll({
      handle: "kid_runner",
      displayName: "Kid Runner",
      isSearchable: true,
      acceptedTerms: true,
      adultDeclaration: true,
      termsVersion: "2026-09-30",
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "http_error") {
      expect(result.error.status).toBe(403);
      expect(result.error.code).toBe("COMMUNITY_AGE_RESTRICTED");
    }
    expect(request).not.toHaveBeenCalled();
    expect(controller.getState().error).toBe(
      "We cannot confirm Community eligibility from your birth year. Your private tracking stays available.",
    );
  });

  it("allows enrollment for adult user and updates state to enrolled", async () => {
    const createdProfile = {
      userId: "u-1",
      handle: "adult_runner",
      displayName: "Adult Runner",
      avatarSymbol: "AR",
      bio: null,
      isSearchable: true,
      status: "active" as const,
      generation: 1,
      createdAt: "2026-09-29T10:00:00Z",
      updatedAt: "2026-09-29T10:00:00Z",
    };
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: createdProfile,
    });
    const client = { request } as unknown as ApiClient;

    const controller = new CommunityProfileController({
      client,
      birthYear: 1990,
      now: mockNow,
      autoLoad: false,
    });

    const result = await controller.enroll({
      handle: "adult_runner",
      displayName: "Adult Runner",
      isSearchable: true,
      acceptedTerms: true,
      adultDeclaration: true,
      termsVersion: "2026-09-30",
    });

    expect(result.ok).toBe(true);
    expect(controller.getState().isEnrolled).toBe(true);
    expect(controller.getState().profile?.handle).toBe("adult_runner");
  });

  it("transitions to withdrawn state upon withdrawal", async () => {
    const existingProfile = {
      userId: "u-1",
      handle: "adult_runner",
      displayName: "Adult Runner",
      avatarSymbol: "AR",
      bio: null,
      isSearchable: true,
      status: "active" as const,
      generation: 1,
      createdAt: "2026-09-29T10:00:00Z",
      updatedAt: "2026-09-29T10:00:00Z",
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: existingProfile })
      .mockResolvedValueOnce({ ok: true, value: { withdrawn: true } });
    const client = { request } as unknown as ApiClient;

    const controller = new CommunityProfileController({
      client,
      birthYear: 1990,
      now: mockNow,
      autoLoad: false,
    });

    await controller.load();
    expect(controller.getState().isEnrolled).toBe(true);

    const withdrawResult = await controller.withdraw();
    expect(withdrawResult.ok).toBe(true);
    expect(controller.getState().isEnrolled).toBe(false);
    expect(controller.getState().isWithdrawn).toBe(true);
    expect(controller.getState().profile?.status).toBe("withdrawn");
  });
  it("does not resurrect an active profile when a stale load settles after withdrawal", async () => {
    const activeProfile = {
      userId: "00000000-0000-0000-0000-000000000001",
      handle: "adult_runner",
      displayName: "Adult",
      avatarSymbol: "AD",
      bio: null,
      isSearchable: true,
      status: "active",
      generation: 1,
      createdAt: "2026-09-29T10:00:00Z",
      updatedAt: "2026-09-29T10:00:00Z",
    };
    let finishLoad!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLoad = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true, value: { withdrawn: true } });
    const controller = new CommunityProfileController({
      client: { request } as unknown as ApiClient,
      birthYear: 1990,
      autoLoad: false,
    });
    const pendingLoad = controller.load();
    await controller.withdraw();
    finishLoad({ ok: true, value: activeProfile });
    await pendingLoad;
    expect(controller.getState().isEnrolled).toBe(false);
    expect(controller.getState().isWithdrawn).toBe(true);
  });

  it("clears private identity and enrollment when revalidation loses its session", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { userId: "u-1", status: "active" },
      })
      .mockResolvedValueOnce({ ok: false, error: { kind: "no_session" } });
    const controller = new CommunityProfileController({
      client: { request } as unknown as ApiClient,
      autoLoad: false,
    });
    await controller.load();
    await controller.load();
    expect(controller.getState().profile).toBeNull();
    expect(controller.getState().isEnrolled).toBe(false);
    expect(controller.getState().status).toBe("error");
  });

  it("does not send mutations using an action retained after its controller is destroyed", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, value: { withdrawn: true } });
    const controller = new CommunityProfileController({
      client: { request } as unknown as ApiClient,
      birthYear: 1990,
      autoLoad: false,
    });
    controller.destroy();
    await controller.withdraw();
    expect(request).not.toHaveBeenCalled();
  });

  it("retires a previous effect request and reloads after StrictMode cleanup replay", async () => {
    let finishFirst!: (value: unknown) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: false,
        error: {
          kind: "http_error",
          status: 404,
          code: "COMMUNITY_NOT_ENROLLED",
        },
      });
    const controller = new CommunityProfileController({
      client: { request } as unknown as ApiClient,
      autoLoad: false,
    });
    const first = controller.load();
    controller.destroy();
    controller.activate();
    await controller.load();
    finishFirst({ ok: true, value: { userId: "old-user", status: "active" } });
    await first;
    expect(controller.getState().status).toBe("ready");
    expect(controller.getState().profile).toBeNull();
  });

  it("does not fetch or mutate for a principal that changed before effect cleanup", async () => {
    let principal = "alice";
    const request = vi.fn();
    const controller = new CommunityProfileController({
      client: { request } as unknown as ApiClient,
      principalKey: "alice",
      isCurrentPrincipal: () => principal === "alice",
      birthYear: 1990,
      autoLoad: false,
    });
    principal = "bob";
    await controller.load();
    await controller.enroll({
      handle: "alice_runner",
      displayName: "Alice",
      isSearchable: true,
      acceptedTerms: true,
      adultDeclaration: true,
      termsVersion: "2026-09-30",
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("Community profile lifecycle boundaries", () => {
  const activeProfile = {
    userId: "00000000-0000-0000-0000-000000000001",
    handle: "reserved_runner",
    displayName: "Social Runner",
    avatarSymbol: "SR",
    bio: null,
    isSearchable: true,
    status: "active" as const,
    generation: 1,
    createdAt: "2026-09-30T10:00:00Z",
    updatedAt: "2026-09-30T10:00:00Z",
  };
  const input = {
    handle: "reserved_runner",
    displayName: "Social Runner",
    isSearchable: false,
    acceptedTerms: true as const,
    adultDeclaration: true as const,
    termsVersion: "2026-09-30" as const,
  };

  it("uses the UTC conservative cutoff even when the device calendar year differs", async () => {
    const now = new Date("2026-12-31T23:59:59Z");
    vi.spyOn(now, "getFullYear").mockReturnValue(2027);
    const request = vi.fn();
    const controller = new CommunityProfileController({
      client: { request } as unknown as ApiClient,
      birthYear: 2008,
      now: () => now,
      autoLoad: false,
    });
    expect(controller.getState().isAdultEligible).toBe(false);
    expect((await controller.enroll(input)).ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps a withdrawn handle available to the owner without restoring enrollment", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      value: { ...activeProfile, status: "withdrawn", isSearchable: false },
    });
    const controller = new CommunityProfileController({
      client: { request } as unknown as ApiClient,
      birthYear: 1990,
      autoLoad: false,
    });
    await controller.load();
    expect(controller.getState()).toMatchObject({
      status: "ready",
      isWithdrawn: true,
      isEnrolled: false,
    });
    expect(controller.getState().profile?.handle).toBe("reserved_runner");
  });

  it("does not expose active membership on an unknown or ineligible birth year", async () => {
    for (const birthYear of [null, 2008]) {
      const controller = new CommunityProfileController({
        client: {
          request: vi
            .fn()
            .mockResolvedValue({ ok: true, value: activeProfile }),
        } as unknown as ApiClient,
        birthYear,
        now: () => new Date("2026-09-30T12:00:00Z"),
        autoLoad: false,
      });
      await controller.load();
      expect(controller.getState().isEnrolled).toBe(false);
    }
  });

  it("refreshes eligibility at UTC year rollover when the app revalidates", async () => {
    let now = new Date("2026-12-31T23:59:59Z");
    const controller = new CommunityProfileController({
      client: {
        request: vi.fn().mockResolvedValue({ ok: true, value: activeProfile }),
      } as unknown as ApiClient,
      birthYear: 2008,
      now: () => now,
      autoLoad: false,
    });
    await controller.load();
    expect(controller.getState().isEnrolled).toBe(false);
    now = new Date("2027-01-01T00:00:00Z");
    await controller.load();
    expect(controller.getState().isEnrolled).toBe(true);
  });

  it("does not assume an unknown 404 means enrollment can begin", async () => {
    const controller = new CommunityProfileController({
      client: {
        request: vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: "http_error", status: 404, code: "NOT_FOUND" },
        }),
      } as unknown as ApiClient,
      birthYear: 1990,
      autoLoad: false,
    });
    await controller.load();
    expect(controller.getState().status).toBe("error");
  });

  it("requires revalidation after a lost enrollment response, then restores only server-confirmed state", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: "network_error", message: "response lost" },
      })
      .mockResolvedValueOnce({ ok: true, value: activeProfile });
    const controller = new CommunityProfileController({
      client: { request } as unknown as ApiClient,
      birthYear: 1990,
      autoLoad: false,
    });
    const result = await controller.enroll(input);
    expect(result.ok).toBe(false);
    expect(controller.getState()).toMatchObject({
      status: "error",
      isEnrolled: false,
      isSaving: false,
    });
    expect((await controller.enroll(input)).ok).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    await controller.load();
    expect(controller.getState()).toMatchObject({
      status: "ready",
      isEnrolled: true,
    });
    expect(request.mock.calls.map(([options]) => options.method)).toEqual([
      "POST",
      "GET",
    ]);
  });

  it("exposes pending state, prevents duplicate clicks and ignores a mutation settling for another principal", async () => {
    let principal = "alice";
    let resolve!: (value: unknown) => void;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const controller = new CommunityProfileController({
      client: { request } as unknown as ApiClient,
      principalKey: "alice",
      isCurrentPrincipal: () => principal === "alice",
      birthYear: 1990,
      autoLoad: false,
    });
    const pending = controller.enroll(input);
    expect(controller.getState().isSaving).toBe(true);
    expect((await controller.enroll(input)).ok).toBe(false);
    principal = "bob";
    resolve({ ok: true, value: activeProfile });
    expect((await pending).ok).toBe(false);
    expect(controller.getState().isEnrolled).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps suspension non-enrolled while still allowing owner withdrawal", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: { ...activeProfile, status: "suspended" },
      })
      .mockResolvedValueOnce({ ok: true, value: { withdrawn: true } });
    const controller = new CommunityProfileController({
      client: { request } as unknown as ApiClient,
      birthYear: 1990,
      autoLoad: false,
    });
    await controller.load();
    expect(controller.getState().isEnrolled).toBe(false);
    expect((await controller.withdraw()).ok).toBe(true);
    expect(controller.getState().isWithdrawn).toBe(false);
    expect(controller.getState().profile?.status).toBe("suspended");
  });
});
