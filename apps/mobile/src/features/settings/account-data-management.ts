import type { ApiClient } from "@mizyun/api-client";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import {
  accountDeleteChallengeResponseSchema,
  accountDeleteResponseSchema,
  accountExportResponseSchema,
  ANALYTICS_DASHBOARD_CATALOG,
  type AccountDeleteChallengeResponse,
  type AccountDeleteResponse,
  type AccountExportResponse,
} from "@mizyun/contracts";
import {
  clearLoggingDraft,
  type LoggingDraftKind,
} from "../logging-draft-storage";
import { revokeAiConsent } from "../coach/ai-consent";
import {
  clearCoachReminders,
  type ReminderScheduler,
  type ReminderStore,
} from "../coach/coach-reminders";
import {
  clearFirstMealReminders,
  type FirstMealReminderScheduler,
} from "../log-meal/first-meal-reminders";
import {
  clearEveningReminders,
  type EveningReminderScheduler,
} from "../log-meal/evening-catch-up-reminders";
import {
  clearFoodDayCompletions,
  type DayCompletionStore,
} from "../log-meal/food-day-completion";
import { purgeOfflineCache } from "../offline-cache/offline-cache-storage";
import { keyFor as workoutPreferencesKeyFor } from "../workouts/workout-preferences";
import { healthStepsPreferenceKey } from "../health-steps/health-steps-key";

export interface SecureKeyValueStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<unknown>;
  deleteItemAsync(key: string): Promise<unknown>;
}

export interface StoredDeletionChallenge {
  readonly token: string;
  readonly expiresAt: string;
}

const deletionChallengeKey = (userId: string): string =>
  `mizyun.deletion_challenge.${userId}`;

export const saveDeletionChallenge = async (
  userId: string,
  challenge: StoredDeletionChallenge,
  store: SecureKeyValueStore = SecureStore,
): Promise<void> => {
  await store.setItemAsync(
    deletionChallengeKey(userId),
    JSON.stringify(challenge),
  );
};

export const loadDeletionChallenge = async (
  userId: string,
  store: SecureKeyValueStore = SecureStore,
): Promise<StoredDeletionChallenge | null> => {
  try {
    const raw = await store.getItemAsync(deletionChallengeKey(userId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      "expiresAt" in parsed &&
      typeof (parsed as { token: unknown }).token === "string" &&
      typeof (parsed as { expiresAt: unknown }).expiresAt === "string"
    ) {
      const challenge = parsed as StoredDeletionChallenge;
      const expiryTime = new Date(challenge.expiresAt).getTime();
      // Keep expired receipts so a restart can still query the server's
      // durable deletion status. The confirmation endpoint will reject an
      // expired challenge; status recovery must remain possible afterwards.
      if (Number.isNaN(expiryTime)) return null;
      return {
        token: challenge.token,
        expiresAt: challenge.expiresAt,
      };
    }
    return null;
  } catch {
    return null;
  }
};

export const clearDeletionChallenge = async (
  userId: string,
  store: SecureKeyValueStore = SecureStore,
): Promise<void> => {
  await Promise.resolve(
    store.deleteItemAsync(deletionChallengeKey(userId)),
  ).catch(() => {});
};

export type ExportAccountDataResult =
  | { readonly ok: true; readonly data: AccountExportResponse }
  | { readonly ok: false; readonly message: string };

export type RequestAccountDeletionResult =
  | {
      readonly ok: true;
      readonly confirmationToken: string;
      readonly expiresAt: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly retryable: boolean;
    };

export type DeletionFailureReason =
  | "expired"
  | "mismatch"
  | "unauthorized"
  | "server_error"
  | "network_error"
  | "unknown";

export type ConfirmAccountDeletionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly message: string;
      readonly retryable: boolean;
      readonly reason: DeletionFailureReason;
    };

export type AccountDeletionStatusResult =
  | {
      readonly ok: true;
      readonly status:
        "challenge_issued" | "in_progress" | "completed" | "failed";
      readonly stage: "none" | "storage" | "memory" | "auth" | "done";
      readonly completedAt: string | null;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly notFound?: boolean;
    };

interface DeletionStatusResponseBody {
  readonly status: "challenge_issued" | "in_progress" | "completed" | "failed";
  readonly stage: "none" | "storage" | "memory" | "auth" | "done";
  readonly completedAt: string | null;
}

export const checkAccountDeletionStatus = async (
  client: ApiClient,
  confirmationToken: string,
): Promise<AccountDeletionStatusResult> => {
  const result = await client.request<DeletionStatusResponseBody>({
    method: "POST",
    path: "/v1/account/delete/status",
    body: { confirmationToken },
  });

  if (!result.ok) {
    if (result.error.kind === "http_error" && result.error.status === 404) {
      return {
        ok: false,
        notFound: true,
        message: "Deletion request not found.",
      };
    }
    const message =
      result.error.kind === "http_error"
        ? result.error.message
        : "Could not check deletion status. Please try again.";
    return { ok: false, message };
  }

  return {
    ok: true,
    status: result.value.status,
    stage: result.value.stage,
    completedAt: result.value.completedAt,
  };
};

export interface ClearLocalUserDataOptions {
  readonly draftStore?: Parameters<typeof clearLoggingDraft>[2];
  readonly consentStore?: Parameters<typeof revokeAiConsent>[1];
  readonly reminderScheduler?: ReminderScheduler;
  readonly reminderStore?: ReminderStore;
  readonly firstMealReminderScheduler?: FirstMealReminderScheduler;
  readonly firstMealReminderStore?: ReminderStore;
  readonly eveningReminderScheduler?: EveningReminderScheduler;
  readonly eveningReminderStore?: ReminderStore;
  readonly dayCompletionStore?: DayCompletionStore;
  readonly additionalDraftKinds?: readonly LoggingDraftKind[];
  readonly challengeStore?: SecureKeyValueStore;
  readonly offlineCacheStore?: Parameters<typeof purgeOfflineCache>[1];
  readonly workoutPreferencesStore?: SecureKeyValueStore;
  readonly listExportFiles?: () => ReadonlyArray<{
    readonly name: string;
    delete(): void;
  }>;
}

/**
 * Clears all locally persisted state for the given user, including
 * meal/workout/weight/coach drafts, AI consent decisions, scheduled
 * coach reminder notifications, scheduled first-meal notifications,
 * scheduled evening catch-up notifications, confirmed day completions,
 * deletion challenges, workout preferences, offline profile/dashboard
 * caches, and local exported JSON files.
 */
export const clearLocalUserData = async (
  userId: string,
  options: ClearLocalUserDataOptions = {},
): Promise<void> => {
  const standardDraftKinds: readonly LoggingDraftKind[] = [
    "meal",
    "workout",
    "weight",
    "coach",
  ];
  const draftKinds: readonly LoggingDraftKind[] = [
    ...standardDraftKinds,
    ...(options.additionalDraftKinds ?? []),
  ];

  const exportFiles: ReadonlyArray<{ readonly name: string; delete(): void }> =
    (() => {
      try {
        if (options.listExportFiles) {
          return options.listExportFiles();
        }
        const dir = new Directory(Paths.document);
        return dir.list() as Array<{ name: string; delete(): void }>;
      } catch {
        return [];
      }
    })();

  const matchedFiles = exportFiles.filter((file) =>
    /^mizyun-account-export-.*\.json$/.test(file.name),
  );

  const workoutStore = options.workoutPreferencesStore ?? SecureStore;

  await Promise.allSettled([
    ...draftKinds.map((kind) =>
      clearLoggingDraft(userId, kind, options.draftStore),
    ),
    revokeAiConsent(userId, options.consentStore),
    clearCoachReminders(
      userId,
      options.reminderScheduler,
      options.reminderStore,
    ),
    clearFirstMealReminders(
      userId,
      options.firstMealReminderScheduler,
      options.firstMealReminderStore ?? options.reminderStore,
    ),
    clearEveningReminders(
      userId,
      options.eveningReminderScheduler,
      options.eveningReminderStore ?? options.reminderStore,
    ),
    clearFoodDayCompletions(
      userId,
      options.dayCompletionStore ?? options.reminderStore,
    ),
    clearDeletionChallenge(userId, options.challengeStore),
    purgeOfflineCache(userId, options.offlineCacheStore),
    Promise.resolve(
      workoutStore.deleteItemAsync(workoutPreferencesKeyFor(userId)),
    ).catch(() => {}),
    Promise.resolve(
      workoutStore.deleteItemAsync(healthStepsPreferenceKey(userId)),
    ).catch(() => {}),
    ...matchedFiles.map(async (file) => {
      await file.delete();
    }),
  ]);
};

export const fetchAccountExport = async (
  client: ApiClient,
): Promise<ExportAccountDataResult> => {
  const result = await client.request<AccountExportResponse>({
    method: "GET",
    path: `/v1/account/export?catalog=${ANALYTICS_DASHBOARD_CATALOG}`,
    schema: accountExportResponseSchema,
  });

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.error.kind === "http_error" && result.error.status === 401
          ? "You must be signed in to export your data."
          : "Could not export account data. Please try again later.",
    };
  }

  return { ok: true, data: result.value };
};

export const requestAccountDeletion = async (
  client: ApiClient,
): Promise<RequestAccountDeletionResult> => {
  const result = await client.request<AccountDeleteChallengeResponse>({
    method: "POST",
    path: "/v1/account/delete/request",
    schema: accountDeleteChallengeResponseSchema,
  });

  if (!result.ok) {
    const isAuth =
      result.error.kind === "http_error" && result.error.status === 401;
    return {
      ok: false,
      retryable: !isAuth,
      message: isAuth
        ? "You must be signed in to delete your account."
        : "Could not initiate account deletion. Please check your connection and try again.",
    };
  }

  return {
    ok: true,
    confirmationToken: result.value.confirmationToken,
    expiresAt: result.value.expiresAt,
  };
};

export const confirmAccountDeletion = async (
  client: ApiClient,
  confirmationToken: string,
  appleAuthorizationCode?: string,
): Promise<ConfirmAccountDeletionResult> => {
  const result = await client.request<AccountDeleteResponse>({
    method: "DELETE",
    path: "/v1/account",
    body: {
      confirmationToken,
      ...(appleAuthorizationCode ? { appleAuthorizationCode } : {}),
    },
    schema: accountDeleteResponseSchema,
  });

  if (!result.ok) {
    let message = "Could not delete account. Please try again.";
    let reason: DeletionFailureReason = "unknown";
    let retryable = true;

    if (result.error.kind === "http_error") {
      if (result.error.status === 410) {
        reason = "expired";
        retryable = false;
        message = "The deletion request expired. Please request a new one.";
      } else if (result.error.status === 409) {
        reason = "mismatch";
        retryable = false;
        message = "Invalid or mismatching deletion token. Please try again.";
      } else if (result.error.status === 401) {
        reason = "unauthorized";
        retryable = false;
        message = "Your session expired. Please sign in again.";
      } else if (result.error.status >= 500 && result.error.status <= 504) {
        reason = "server_error";
        retryable = true;
        message =
          "Server or storage cleanup encountered a temporary issue. Your deletion request is preserved; please retry.";
      }
    } else if (result.error.kind === "network_error") {
      reason = "network_error";
      retryable = true;
      message =
        "Network connection failed during deletion. Your deletion request is preserved; please retry.";
    }

    return { ok: false, message, retryable, reason };
  }

  return { ok: true };
};

export type SaveExportToFileResult =
  | {
      readonly ok: true;
      readonly fileUri: string;
      readonly fileName: string;
      readonly byteSize: number;
    }
  | { readonly ok: false; readonly message: string };

export interface ExportFileAdapter {
  readonly uri: string;
  write(content: string): void;
}

export const saveExportToFile = async (
  exportResponse: AccountExportResponse,
  createFile?: (fileName: string) => ExportFileAdapter,
): Promise<SaveExportToFileResult> => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `mizyun-account-export-${timestamp}.json`;
    const file = createFile
      ? createFile(fileName)
      : new File(Paths.document, fileName);

    const jsonString = JSON.stringify(exportResponse.export, null, 2);
    file.write(jsonString);

    return {
      ok: true,
      fileUri: file.uri,
      fileName,
      byteSize: jsonString.length,
    };
  } catch {
    return {
      ok: false,
      message: "Could not save account data export to local file storage.",
    };
  }
};
