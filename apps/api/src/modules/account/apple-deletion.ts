import type {
  AccountDeletionCleanupContext,
  AccountProviderRevocation,
  AccountProviderRevocationRepository,
  AccountRepository,
} from "@mizyun/core";
import type { ServerAppleAuthConfiguration } from "@mizyun/config";
import {
  decryptAppleRevocationToken,
  encryptAppleRevocationToken,
  generateAppleClientSecret,
  verifyAppleIdentityToken,
  type AppleAuthClient,
} from "@mizyun/adapter-apple-auth";

export interface AppleDeletionCleanupOptions {
  readonly repository: Pick<AccountRepository, "getLinkedAuthIdentities">;
  readonly config?: ServerAppleAuthConfiguration | null | undefined;
  readonly client?: AppleAuthClient | undefined;
  readonly revocationRepository?:
    AccountProviderRevocationRepository | undefined;
  readonly encryptionKey?: string | undefined;
  readonly verifyIdentityToken?: typeof verifyAppleIdentityToken | undefined;
}

const CLEANUP_ERROR = "Apple account cleanup failed";

/**
 * Apple cleanup result the deletion route may log. `skipped_no_authorization_code`
 * means an Apple identity was linked but the client sent no authorization code
 * (Android, an iPhone without Sign in with Apple, or an installed older build),
 * so deletion continued without revoking the Apple token.
 */
export type AppleDeletionCleanupOutcome =
  "not_required" | "revoked" | "skipped_no_authorization_code";

/** This callback must run only after challenge acceptance and worker lease acquisition. */
export function createAppleDeletionCleanup(
  options: AppleDeletionCleanupOptions,
) {
  return async (
    context: AccountDeletionCleanupContext,
    authorizationCode?: string,
  ): Promise<AppleDeletionCleanupOutcome | undefined> => {
    try {
      const store = options.revocationRepository;
      const existing = store
        ? await store.load({
            jobId: context.jobId,
            userId: context.userId,
            provider: "apple",
          })
        : null;
      if (existing !== null) {
        if (
          existing.jobId !== context.jobId ||
          existing.userId !== context.userId ||
          existing.provider !== "apple"
        )
          throw new Error(CLEANUP_ERROR);
        if (existing.status === "not_required") {
          if (
            existing.subject !== null ||
            existing.clientId !== null ||
            existing.encryptedToken !== null ||
            authorizationCode !== undefined
          )
            throw new Error(CLEANUP_ERROR);
          return "not_required";
        }
        if (existing.status === "skipped_no_authorization_code") {
          // The recorded outcome is final for this deletion job; a resumed
          // attempt continues without revoking, whatever the client sends now.
          if (
            existing.subject !== null ||
            existing.clientId !== null ||
            existing.encryptedToken !== null
          )
            throw new Error(CLEANUP_ERROR);
          return "skipped_no_authorization_code";
        }
        if (existing.status === "revoked") {
          if (
            !existing.subject?.trim() ||
            !existing.clientId?.trim() ||
            existing.clientId !== options.config?.clientId ||
            existing.encryptedToken !== null
          )
            throw new Error(CLEANUP_ERROR);
          return "revoked";
        }
        if (existing.status !== "pending") throw new Error(CLEANUP_ERROR);
      }

      let pending: AccountProviderRevocation;
      let token: string;
      if (existing !== null) {
        const { config, client, encryptionKey } = options;
        if (
          !config ||
          !client ||
          !encryptionKey ||
          !existing.subject?.trim() ||
          existing.clientId !== config.clientId ||
          !existing.encryptedToken
        )
          throw new Error(CLEANUP_ERROR);
        token = decryptAppleRevocationToken(
          existing.encryptedToken,
          encryptionKey,
          {
            jobId: context.jobId,
            userId: context.userId,
            clientId: config.clientId,
            subject: existing.subject,
          },
        );
        pending = existing;
      } else {
        if (!options.repository.getLinkedAuthIdentities) {
          // Preserve ordinary deletion for the test-only in-memory repository.
          if (authorizationCode === undefined && !options.config)
            return undefined;
          throw new Error(CLEANUP_ERROR);
        }
        await context.assertLease();
        const identities = await options.repository.getLinkedAuthIdentities(
          context.userId,
        );
        const appleIdentities = identities.filter(
          (identity) => identity.provider === "apple",
        );
        if (appleIdentities.length === 0) {
          if (authorizationCode !== undefined) throw new Error(CLEANUP_ERROR);
          if (store) {
            await context.assertLease();
            await store.save(
              {
                jobId: context.jobId,
                userId: context.userId,
                provider: "apple",
                status: "not_required",
                subject: null,
                clientId: null,
                encryptedToken: null,
              },
              { workerId: context.workerId },
            );
          }
          return "not_required";
        }
        if (authorizationCode === undefined) {
          // No code arrived, so Apple cannot be asked to revoke. Deletion must
          // still proceed (the user asked to delete their account); record
          // the truthful outcome without storing the Apple subject.
          if (store) {
            await context.assertLease();
            await store.save(
              {
                jobId: context.jobId,
                userId: context.userId,
                provider: "apple",
                status: "skipped_no_authorization_code",
                subject: null,
                clientId: null,
                encryptedToken: null,
              },
              { workerId: context.workerId },
            );
          }
          return "skipped_no_authorization_code";
        }
        const { config, client, encryptionKey } = options;
        const subject = appleIdentities[0]?.subject;
        if (
          appleIdentities.length !== 1 ||
          !subject?.trim() ||
          !config ||
          !client ||
          !encryptionKey ||
          !store ||
          typeof authorizationCode !== "string" ||
          !authorizationCode.trim()
        )
          throw new Error(CLEANUP_ERROR);
        // Validate protection configuration before consuming a single-use authorization code.
        encryptAppleRevocationToken("configuration-check", encryptionKey, {
          jobId: context.jobId,
          userId: context.userId,
          clientId: config.clientId,
          subject,
        });
        const clientSecret = generateAppleClientSecret({
          ...config,
          expiresInSeconds: 300,
        });
        await context.assertLease();
        const exchange = await client.exchangeAuthorizationCode({
          code: authorizationCode,
          clientId: config.clientId,
          clientSecret,
        });
        if (!exchange.ok) throw new Error(CLEANUP_ERROR);
        await context.assertLease();
        await (options.verifyIdentityToken ?? verifyAppleIdentityToken)(
          exchange.value.idToken,
          { clientId: config.clientId, subject },
        );
        token = exchange.value.refreshToken;
        pending = {
          jobId: context.jobId,
          userId: context.userId,
          provider: "apple",
          status: "pending",
          subject,
          clientId: config.clientId,
          encryptedToken: encryptAppleRevocationToken(token, encryptionKey, {
            jobId: context.jobId,
            userId: context.userId,
            clientId: config.clientId,
            subject,
          }),
        };
        await context.assertLease();
        await store.save(pending, { workerId: context.workerId });
      }

      const { config, client } = options;
      if (!config || !client || !store) throw new Error(CLEANUP_ERROR);
      await context.assertLease();
      const revoked = await client.revokeToken({
        token,
        tokenTypeHint: "refresh_token",
        clientId: config.clientId,
        clientSecret: generateAppleClientSecret({
          ...config,
          expiresInSeconds: 300,
        }),
      });
      if (!revoked.ok) throw new Error(CLEANUP_ERROR);
      await context.assertLease();
      await store.save(
        { ...pending, status: "revoked", encryptedToken: null },
        { workerId: context.workerId },
      );
      return "revoked";
    } catch {
      // Provider, token, key and repository details must not escape into deletion jobs or routes.
      throw new Error(CLEANUP_ERROR);
    }
  };
}
