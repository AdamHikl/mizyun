import type { ApiClient } from "@mizyun/api-client";
import {
  accountDeleteChallengeResponseSchema,
  accountDeleteResponseSchema,
  accountExportResponseSchema,
  type AccountDeleteChallengeResponse,
  type AccountDeleteResponse,
  type AccountExportResponse,
} from "@mizyun/contracts";

export type ExportAccountDataResult =
  | { readonly ok: true; readonly data: AccountExportResponse }
  | { readonly ok: false; readonly message: string };

export type RequestAccountDeletionResult =
  | {
      readonly ok: true;
      readonly confirmationToken: string;
      readonly expiresAt: string;
    }
  | { readonly ok: false; readonly message: string };

export type ConfirmAccountDeletionResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

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
    return {
      ok: false,
      message:
        result.error.kind === "http_error" && result.error.status === 401
          ? "You must be signed in to delete your account."
          : "Could not initiate account deletion. Please try again.",
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
    if (result.error.kind === "http_error") {
      if (result.error.status === 410) {
        message = "The deletion request expired. Please request a new one.";
      } else if (result.error.status === 409) {
        message = "Invalid or mismatching deletion token. Please try again.";
      } else if (result.error.status === 401) {
        message = "Your session expired. Please sign in again.";
      }
    }
    return { ok: false, message };
  }

  return { ok: true };
};
