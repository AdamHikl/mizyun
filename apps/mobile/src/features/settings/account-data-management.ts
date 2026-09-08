import type { ApiClient } from "@mizyun/api-client";
import { File, Paths } from "expo-file-system";
import {
  accountDeleteChallengeResponseSchema,
  accountDeleteResponseSchema,
  accountExportResponseSchema,
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

export interface ClearLocalUserDataOptions {
  readonly draftStore?: Parameters<typeof clearLoggingDraft>[2];
  readonly consentStore?: Parameters<typeof revokeAiConsent>[1];
  readonly reminderScheduler?: ReminderScheduler;
  readonly reminderStore?: ReminderStore;
  readonly additionalDraftKinds?: readonly LoggingDraftKind[];
}

/**
 * Clears all locally persisted state for the given user, including
 * meal/workout/weight/coach drafts, AI consent decisions, and scheduled
 * coach reminder notifications.
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
  ]);
};

export const fetchAccountExport = async (
  client: ApiClient,
): Promise<ExportAccountDataResult> => {
  const result = await client.request<AccountExportResponse>({
    method: "GET",
    path: "/v1/account/export",
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
): Promise<ConfirmAccountDeletionResult> => {
  const result = await client.request<AccountDeleteResponse>({
    method: "DELETE",
    path: "/v1/account",
    body: { confirmationToken },
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
      } else if (result.error.status === 500 || result.error.status === 503) {
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
