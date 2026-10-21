import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  err,
  ok,
  type AccountDeletionCleanupContext,
  type AccountProviderRevocation,
  type UserId,
} from "@mizyun/core";
import {
  decryptAppleRevocationToken,
  type AppleAuthClient,
} from "@mizyun/adapter-apple-auth";
import { createAppleDeletionCleanup } from "./apple-deletion.js";

const signingKey = generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();
const config = {
  clientId: "com.mizyun.app",
  teamId: "team",
  keyId: "key",
  privateKey: signingKey,
};
const encryptionKey = Buffer.alloc(32, 2).toString("base64");
const userId = "account-a" as UserId;
const baseContext = {
  jobId: "job-a",
  userId,
  workerId: "worker-a",
  stage: "none" as const,
};

function setup() {
  const state: { record: AccountProviderRevocation | null } = { record: null };
  const events: string[] = [];
  const repository = {
    getLinkedAuthIdentities: vi.fn(async () => [
      { provider: "apple", subject: "apple-a" },
    ]),
  };
  const revocationRepository = {
    load: vi.fn(async () => state.record),
    save: vi.fn(
      async (
        record: AccountProviderRevocation,
        _options: { workerId: string },
      ) => {
        events.push(record.status);
        state.record = { ...record };
      },
    ),
  };
  const client = {
    exchangeAuthorizationCode: vi.fn<
      AppleAuthClient["exchangeAuthorizationCode"]
    >(async () => {
      events.push("exchange");
      return ok({
        accessToken: "secret-access",
        refreshToken: "secret-refresh",
        idToken: "secret-identity",
        expiresIn: 3600,
      });
    }),
    revokeToken: vi.fn<AppleAuthClient["revokeToken"]>(async () => {
      events.push("revoke");
      return ok(undefined);
    }),
  };
  const verifyIdentityToken = vi.fn(
    async (_token: string, _options: { clientId: string; subject: string }) => {
      events.push("verify");
    },
  );
  const context: AccountDeletionCleanupContext = {
    ...baseContext,
    assertLease: vi.fn(async () => {}),
  };
  const options = {
    repository,
    revocationRepository,
    client,
    config,
    encryptionKey,
    verifyIdentityToken,
  };
  return {
    state,
    events,
    repository,
    revocationRepository,
    client,
    verifyIdentityToken,
    context,
    options,
  };
}

describe("Apple cleanup under accepted deletion job", () => {
  it("binds identity verification, persists encrypted recovery before revocation and clears secrets on completion", async () => {
    const f = setup();
    await createAppleDeletionCleanup(f.options)(f.context, "fresh-code");
    expect(f.events).toEqual([
      "exchange",
      "verify",
      "pending",
      "revoke",
      "revoked",
    ]);
    expect(f.verifyIdentityToken).toHaveBeenCalledWith("secret-identity", {
      clientId: config.clientId,
      subject: "apple-a",
    });
    const pending = f.revocationRepository.save.mock.calls[0]![0];
    expect(pending.encryptedToken).not.toContain("secret-refresh");
    expect(
      decryptAppleRevocationToken(pending.encryptedToken!, encryptionKey, {
        ...baseContext,
        clientId: config.clientId,
        subject: "apple-a",
      }),
    ).toBe("secret-refresh");
    expect(
      f.revocationRepository.save.mock.calls.every(
        (call) => call[1].workerId === "worker-a",
      ),
    ).toBe(true);
    expect(f.state.record).toEqual({
      ...pending,
      status: "revoked",
      encryptedToken: null,
    });
  });

  it("resumes persisted pending state after a provider failure without reusing a single-use code or querying deleted Auth", async () => {
    const f = setup();
    f.client.revokeToken.mockImplementationOnce(async () => {
      throw new Error("secret-refresh provider failure");
    });
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "single-use-code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.state.record?.status).toBe("pending");
    f.repository.getLinkedAuthIdentities.mockRejectedValue(
      new Error("Auth no longer exists"),
    );
    await createAppleDeletionCleanup(f.options)(
      { ...f.context, workerId: "worker-b" },
      "single-use-code",
    );
    expect(f.client.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(f.verifyIdentityToken).toHaveBeenCalledTimes(1);
    expect(f.repository.getLinkedAuthIdentities).toHaveBeenCalledTimes(1);
    expect(f.client.revokeToken).toHaveBeenCalledTimes(2);
    expect(f.state.record?.status).toBe("revoked");
  });

  it("retries revocation after its success response is lost before completion persistence", async () => {
    const f = setup();
    f.revocationRepository.save.mockImplementationOnce(async (record) => {
      f.state.record = record;
    });
    f.revocationRepository.save.mockRejectedValueOnce(
      new Error("database secret"),
    );
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "single-use-code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.state.record?.status).toBe("pending");
    await createAppleDeletionCleanup(f.options)(f.context);
    expect(f.client.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(f.client.revokeToken).toHaveBeenCalledTimes(2);
    expect(f.state.record?.status).toBe("revoked");
  });

  it("does not revoke when verified-token persistence fails and needs fresh authorization for the same job", async () => {
    const f = setup();
    f.revocationRepository.save.mockRejectedValueOnce(
      new Error("token persistence failed"),
    );
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "consumed-code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.client.revokeToken).not.toHaveBeenCalled();
    expect(f.state.record).toBeNull();
    await createAppleDeletionCleanup(f.options)(f.context, "fresh-code");
    expect(f.client.exchangeAuthorizationCode).toHaveBeenCalledTimes(2);
    expect(f.state.record?.status).toBe("revoked");
  });

  it("continues deletion without an authorization code and records a subject-free skipped outcome", async () => {
    const f = setup();
    // Even without Apple configuration (for example an Android-only host).
    const options = {
      repository: f.repository,
      revocationRepository: f.revocationRepository,
    };
    await expect(createAppleDeletionCleanup(options)(f.context)).resolves.toBe(
      "skipped_no_authorization_code",
    );
    expect(f.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(f.client.revokeToken).not.toHaveBeenCalled();
    expect(f.context.assertLease).toHaveBeenCalled();
    expect(f.state.record).toEqual({
      jobId: baseContext.jobId,
      userId,
      provider: "apple",
      status: "skipped_no_authorization_code",
      subject: null,
      clientId: null,
      encryptedToken: null,
    });
    expect(JSON.stringify(f.state.record)).not.toContain("apple-a");
    // The recorded outcome is final for this job: a resumed attempt neither
    // fails nor exchanges a later code.
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "late-code"),
    ).resolves.toBe("skipped_no_authorization_code");
    expect(f.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(f.revocationRepository.save).toHaveBeenCalledTimes(1);
  });

  it("keeps the strict path when a code arrives: missing protection still fails before exchange", async () => {
    const f = setup();
    await expect(
      createAppleDeletionCleanup({ ...f.options, encryptionKey: undefined })(
        f.context,
        "fresh-code",
      ),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(f.state.record).toBeNull();
  });

  it("finishes a persisted pending revocation even when the resumed request has no code", async () => {
    const f = setup();
    f.client.revokeToken.mockResolvedValueOnce(
      err({ kind: "http_error", error: "server_error", message: "down" }),
    );
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "fresh-code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.state.record?.status).toBe("pending");
    await expect(
      createAppleDeletionCleanup(f.options)(f.context),
    ).resolves.toBe("revoked");
    expect(f.state.record?.status).toBe("revoked");
  });

  it("rejects a skipped marker that carries Apple identity data", async () => {
    const f = setup();
    f.state.record = {
      jobId: baseContext.jobId,
      userId,
      provider: "apple",
      status: "skipped_no_authorization_code",
      subject: "apple-a",
      clientId: null,
      encryptedToken: null,
    };
    await expect(
      createAppleDeletionCleanup(f.options)(f.context),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
  });

  it("does not store or revoke an exchanged token whose identity fails verification", async () => {
    const f = setup();
    f.verifyIdentityToken.mockRejectedValue(
      new Error("secret-identity subject mismatch"),
    );
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.revocationRepository.save).not.toHaveBeenCalled();
    expect(f.client.revokeToken).not.toHaveBeenCalled();
  });

  it("persists non-Apple completion and rejects client-supplied Apple codes for that account", async () => {
    const f = setup();
    f.repository.getLinkedAuthIdentities.mockResolvedValue([
      { provider: "google", subject: "google-a" },
    ]);
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "another-accounts-code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.revocationRepository.save).not.toHaveBeenCalled();
    await createAppleDeletionCleanup({
      repository: f.repository,
      revocationRepository: f.revocationRepository,
    })(f.context);
    expect(f.state.record).toEqual({
      jobId: baseContext.jobId,
      userId,
      provider: "apple",
      status: "not_required",
      subject: null,
      clientId: null,
      encryptedToken: null,
    });
    f.repository.getLinkedAuthIdentities.mockRejectedValue(
      new Error("deleted Auth"),
    );
    await createAppleDeletionCleanup({
      repository: f.repository,
      revocationRepository: f.revocationRepository,
    })(f.context);
    expect(f.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("allows non-Apple deletion without config or store and limits the in-memory lookup exception", async () => {
    const f = setup();
    f.repository.getLinkedAuthIdentities.mockResolvedValue([]);
    await createAppleDeletionCleanup({ repository: f.repository })(f.context);
    await createAppleDeletionCleanup({ repository: {} })(f.context);
    await expect(
      createAppleDeletionCleanup({ repository: {}, config })(f.context),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    await expect(
      createAppleDeletionCleanup({ repository: {} })(f.context, "code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
  });

  it.each([
    "config",
    "client",
    "encryptionKey",
    "revocationRepository",
  ] as const)(
    "fails linked Apple cleanup before exchange when %s is unavailable",
    async (field) => {
      const f = setup();
      await expect(
        createAppleDeletionCleanup({ ...f.options, [field]: undefined })(
          f.context,
          "code",
        ),
      ).rejects.toThrow(/^Apple account cleanup failed$/);
      expect(f.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
    },
  );

  it("validates the dedicated encryption key before consuming authorization", async () => {
    const f = setup();
    await expect(
      createAppleDeletionCleanup({ ...f.options, encryptionKey: "wrong-key" })(
        f.context,
        "code",
      ),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.client.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("rechecks current trusted Apple identity on each fresh exchange and rejects ambiguous subjects", async () => {
    const f = setup();
    f.repository.getLinkedAuthIdentities.mockResolvedValue([
      { provider: "apple", subject: "apple-current" },
    ]);
    await createAppleDeletionCleanup(f.options)(f.context, "code");
    expect(f.verifyIdentityToken).toHaveBeenCalledWith("secret-identity", {
      clientId: config.clientId,
      subject: "apple-current",
    });
    f.state.record = null;
    f.repository.getLinkedAuthIdentities.mockResolvedValue([
      { provider: "apple", subject: "apple-a" },
      { provider: "apple", subject: "apple-b" },
    ]);
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.client.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
  });

  it("rejects recovery state from another job/account or an audience change", async () => {
    const f = setup();
    f.client.revokeToken.mockRejectedValueOnce(new Error("retry"));
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    const pending = f.state.record!;
    for (const changed of [
      { ...pending, jobId: "other-job" },
      { ...pending, userId: "other-user" as UserId },
      { ...pending, subject: "other-subject" },
      { ...pending, clientId: "other-audience" },
    ]) {
      f.state.record = changed;
      await expect(
        createAppleDeletionCleanup(f.options)(f.context),
      ).rejects.toThrow(/^Apple account cleanup failed$/);
    }
    expect(f.client.revokeToken).toHaveBeenCalledTimes(1);
  });

  it("uses a completed marker with the correct configured audience without requiring deleted Auth, client or encryption key", async () => {
    const f = setup();
    await createAppleDeletionCleanup(f.options)(f.context, "code");
    await createAppleDeletionCleanup({
      repository: {},
      revocationRepository: f.revocationRepository,
      config,
    })(f.context, "old-code");
    expect(f.client.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(f.client.revokeToken).toHaveBeenCalledTimes(1);
  });

  it("rejects completed Apple recovery with a different audience or missing audience configuration", async () => {
    const f = setup();
    await createAppleDeletionCleanup(f.options)(f.context, "code");
    for (const expectedConfig of [
      undefined,
      { ...config, clientId: "other-audience" },
    ]) {
      await expect(
        createAppleDeletionCleanup({
          repository: {},
          revocationRepository: f.revocationRepository,
          config: expectedConfig,
        })(f.context),
      ).rejects.toThrow(/^Apple account cleanup failed$/);
    }
    const completed = f.state.record!;
    f.state.record = { ...completed, clientId: "wrong-recorded-audience" };
    await expect(
      createAppleDeletionCleanup({
        repository: {},
        revocationRepository: f.revocationRepository,
        config,
      })(f.context),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.client.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(f.client.revokeToken).toHaveBeenCalledTimes(1);
    expect(f.revocationRepository.save).toHaveBeenCalledTimes(2);
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "fences side effects if lease assertion %i fails",
    async (failedAssertion) => {
      const f = setup();
      let count = 0;
      const context = {
        ...f.context,
        assertLease: vi.fn(async () => {
          if (++count === failedAssertion) throw new Error("lease lost");
        }),
      };
      await expect(
        createAppleDeletionCleanup(f.options)(context, "code"),
      ).rejects.toThrow(/^Apple account cleanup failed$/);
      expect(f.client.exchangeAuthorizationCode).toHaveBeenCalledTimes(
        failedAssertion > 2 ? 1 : 0,
      );
      expect(f.verifyIdentityToken).toHaveBeenCalledTimes(
        failedAssertion > 3 ? 1 : 0,
      );
      expect(f.revocationRepository.save).toHaveBeenCalledTimes(
        failedAssertion > 4 ? 1 : 0,
      );
      expect(f.client.revokeToken).toHaveBeenCalledTimes(
        failedAssertion > 5 ? 1 : 0,
      );
      expect(f.state.record?.status).not.toBe("revoked");
    },
  );

  it("scrubs provider Result failures as well as thrown identity/store failures", async () => {
    const f = setup();
    f.client.exchangeAuthorizationCode.mockImplementationOnce(async () =>
      err({
        kind: "http_error" as const,
        message: "secret-code",
        cause: "secret-access",
      }),
    );
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
    expect(f.client.revokeToken).not.toHaveBeenCalled();
    f.repository.getLinkedAuthIdentities.mockRejectedValue(
      new Error("secret-identity"),
    );
    await expect(
      createAppleDeletionCleanup(f.options)(f.context, "code"),
    ).rejects.toThrow(/^Apple account cleanup failed$/);
  });
});
