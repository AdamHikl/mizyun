import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { ApiClient } from "@mizyun/api-client";

import { loadAiConsent, revokeAiConsent, saveAiConsent } from "./ai-consent";

/**
 * Lifecycle and modal state machine states for mobile AI consent (Finding Q7 / REL-AUD-005).
 */
export type AiConsentStatusState =
  "loading" | "ready" | "required" | "saving" | "error" | "revoked";

/**
 * Discriminated union of pending AI actions captured before consent was granted.
 * Stored as pure typed data rather than a raw closure, preventing retention of stale state.
 */
export type PendingAiAction =
  | {
      readonly kind: "coach_message";
      readonly text: string;
      readonly idempotencyKey?: string;
    }
  | {
      readonly kind: "coach_photo";
      readonly photoUri: string;
      readonly idempotencyKey?: string;
    }
  | { readonly kind: "meal_text_draft"; readonly text: string }
  | { readonly kind: "meal_photo_draft"; readonly photoUri: string }
  | { readonly kind: "meal_refine_draft"; readonly instruction: string };

export interface AiConsentControllerOptions {
  readonly userId: string | null;
  readonly onExecuteAction?: (action: PendingAiAction) => void | Promise<void>;
  readonly apiClient?: ApiClient;
  readonly getConsent?: (
    userId: string,
  ) => Promise<{ granted: boolean; confirmedAdult: boolean }>;
  readonly saveConsent?: (
    userId: string,
    granted: boolean,
    confirmedAdult: boolean,
  ) => Promise<boolean>;
  readonly revokeConsent?: (userId: string) => Promise<boolean>;
  readonly autoLoad?: boolean;
}

export interface AiConsentControllerState {
  readonly status: AiConsentStatusState;
  readonly consentGranted: boolean;
  readonly confirmedAdult: boolean;
  readonly error: string | null;
  readonly pendingAction: PendingAiAction | null;
  readonly isModalVisible: boolean;
}

export interface AiConsentControllerActions {
  readonly requestAction: (action: PendingAiAction) => Promise<void>;
  readonly confirmConsent: () => Promise<void>;
  readonly declineConsent: () => void;
  readonly revokeConsent: () => Promise<void>;
  readonly retryPendingAction: () => Promise<void>;
}

const defaultGetConsent = async (
  userId: string,
  apiClient?: ApiClient,
): Promise<{ granted: boolean; confirmedAdult: boolean }> => {
  const status = await loadAiConsent(userId, undefined, apiClient);
  return {
    granted: status.granted,
    confirmedAdult: status.confirmedAdult,
  };
};

const defaultSaveConsent = async (
  userId: string,
  granted: boolean,
  confirmedAdult: boolean,
  apiClient?: ApiClient,
): Promise<boolean> => {
  return saveAiConsent(userId, granted, confirmedAdult, undefined, apiClient);
};

const defaultRevokeConsent = async (
  userId: string,
  apiClient?: ApiClient,
): Promise<boolean> => {
  return revokeAiConsent(userId, undefined, apiClient);
};

/**
 * Controller class managing the AI consent state machine, account scoping,
 * execution lock for rapid taps, and typed pending action continuation.
 */
export class AiConsentController {
  private options: Required<
    Omit<AiConsentControllerOptions, "onExecuteAction" | "apiClient">
  > & {
    onExecuteAction?: (action: PendingAiAction) => void | Promise<void>;
    apiClient?: ApiClient;
  };
  private state: AiConsentControllerState;
  private readonly listeners = new Set<() => void>();
  private activeUserId: string | null = null;
  private requestId = 0;
  private isSaving = false;
  private isExecuting = false;
  private isDestroyed = false;
  private currentLoadPromise: Promise<void> | null = null;

  constructor(options: AiConsentControllerOptions) {
    this.options = {
      userId: options.userId,
      onExecuteAction: options.onExecuteAction,
      apiClient: options.apiClient,
      getConsent:
        options.getConsent ??
        ((userId) => defaultGetConsent(userId, options.apiClient)),
      saveConsent:
        options.saveConsent ??
        ((userId, granted, adult) =>
          defaultSaveConsent(userId, granted, adult, options.apiClient)),
      revokeConsent:
        options.revokeConsent ??
        ((userId) => defaultRevokeConsent(userId, options.apiClient)),
      autoLoad: options.autoLoad ?? true,
    };
    this.activeUserId = options.userId;

    const initialStatus: AiConsentStatusState =
      options.userId === null ? "ready" : "loading";

    this.state = {
      status: initialStatus,
      consentGranted: false,
      confirmedAdult: false,
      error: null,
      pendingAction: null,
      isModalVisible: false,
    };

    if (this.options.autoLoad && options.userId !== null) {
      this.loadConsentForUser(options.userId);
    }
  }

  public getUserId(): string | null {
    return this.activeUserId;
  }

  public waitForLoad(): Promise<void> {
    return this.currentLoadPromise ?? Promise.resolve();
  }

  private loadConsentForUser(userId: string): Promise<void> {
    const currentRequestId = ++this.requestId;
    const promise = this.options.getConsent(userId).then(
      (result) => {
        if (
          this.isDestroyed ||
          this.requestId !== currentRequestId ||
          this.activeUserId !== userId
        ) {
          return;
        }
        this.updateState({
          status: "ready",
          consentGranted: result.granted,
          confirmedAdult: result.confirmedAdult,
          error: null,
        });
      },
      (_error) => {
        if (
          this.isDestroyed ||
          this.requestId !== currentRequestId ||
          this.activeUserId !== userId
        ) {
          return;
        }
        this.updateState({
          status: "error",
          error: "Failed to load AI consent.",
          consentGranted: false,
          confirmedAdult: false,
        });
      },
    );
    this.currentLoadPromise = promise;
    return promise;
  }

  private updateState(
    partial: Partial<Omit<AiConsentControllerState, "isModalVisible">>,
  ): void {
    const nextStatus = partial.status ?? this.state.status;
    this.state = {
      ...this.state,
      ...partial,
      isModalVisible: nextStatus === "required",
    };
    for (const listener of this.listeners) {
      listener();
    }
  }

  public getState = (): AiConsentControllerState => {
    return this.state;
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public updateOptions(options: Partial<AiConsentControllerOptions>): void {
    if (this.isDestroyed) {
      return;
    }
    this.options = {
      ...this.options,
      ...options,
    };
    if (options.userId !== undefined && options.userId !== this.activeUserId) {
      this.updateUserId(options.userId);
    }
  }

  public updateUserId(userId: string | null): void {
    if (this.isDestroyed) {
      return;
    }
    if (this.activeUserId === userId && this.options.userId === userId) {
      return;
    }

    this.activeUserId = userId;
    this.options = {
      ...this.options,
      userId,
    };
    this.requestId++; // Cancels/ignores any in-flight promises from old user

    // Clear pendingAction and reset granted state
    this.updateState({
      pendingAction: null,
      error: null,
      consentGranted: false,
      confirmedAdult: false,
      status: userId === null ? "ready" : "loading",
    });

    if (userId !== null && this.options.autoLoad) {
      this.loadConsentForUser(userId);
    }
  }

  public async requestAction(action: PendingAiAction): Promise<void> {
    if (this.isDestroyed || this.options.userId === null) {
      return;
    }

    if (this.state.consentGranted && this.state.confirmedAdult) {
      if (this.isExecuting) {
        return;
      }
      this.isExecuting = true;
      try {
        await this.options.onExecuteAction?.(action);
      } finally {
        this.isExecuting = false;
      }
      return;
    }

    this.updateState({
      status: "required",
      pendingAction: action,
      error: null,
    });
  }

  public async confirmConsent(): Promise<void> {
    const targetUserId = this.options.userId;
    if (this.isDestroyed || targetUserId === null) {
      return;
    }

    // Double tap / rapid click lock
    if (this.isSaving) {
      return;
    }
    this.isSaving = true;

    try {
      this.updateState({ status: "saving", error: null });

      let saved = false;
      try {
        saved = await this.options.saveConsent(targetUserId, true, true);
      } catch {
        saved = false;
      }

      if (
        this.isDestroyed ||
        this.activeUserId !== targetUserId ||
        this.options.userId !== targetUserId
      ) {
        return;
      }

      if (saved) {
        const actionToDispatch = this.state.pendingAction;
        // Clear pendingAction before executing
        this.updateState({
          status: "ready",
          consentGranted: true,
          confirmedAdult: true,
          error: null,
          pendingAction: null,
        });

        if (actionToDispatch !== null) {
          if (!this.isExecuting) {
            this.isExecuting = true;
            try {
              await this.options.onExecuteAction?.(actionToDispatch);
            } finally {
              this.isExecuting = false;
            }
          }
        }
      } else {
        this.updateState({
          status: "error",
          error: "Failed to save AI consent. Please try again.",
        });
      }
    } finally {
      this.isSaving = false;
    }
  }

  public declineConsent(): void {
    if (this.isDestroyed) {
      return;
    }
    this.updateState({
      status: "ready",
      pendingAction: null,
      error: null,
    });
  }

  public async revokeConsent(): Promise<void> {
    const targetUserId = this.options.userId;
    if (this.isDestroyed || targetUserId === null) {
      return;
    }

    if (this.isSaving) {
      return;
    }
    this.isSaving = true;

    try {
      this.updateState({ status: "saving", error: null });

      let revoked = false;
      try {
        revoked = await this.options.revokeConsent(targetUserId);
      } catch {
        revoked = false;
      }

      if (
        this.isDestroyed ||
        this.activeUserId !== targetUserId ||
        this.options.userId !== targetUserId
      ) {
        return;
      }

      if (revoked) {
        this.updateState({
          status: "revoked",
          consentGranted: false,
          confirmedAdult: false,
          pendingAction: null,
          error: null,
        });
      } else {
        this.updateState({
          status: "error",
          error: "Failed to revoke AI consent. Please try again.",
        });
      }
    } finally {
      this.isSaving = false;
    }
  }

  public async retryPendingAction(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }
    if (this.state.status === "error" && this.state.pendingAction !== null) {
      await this.confirmConsent();
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.listeners.clear();
    this.updateState({
      pendingAction: null,
    });
  }
}

export const createAiConsentController = (
  options: AiConsentControllerOptions,
): AiConsentController => new AiConsentController(options);

/**
 * Shared React hook for AI consent flow across Coach, Meal logging, and future AI touchpoints.
 * Addresses Finding Q7 / REL-AUD-005.
 */
export function useAiConsentController(
  options: AiConsentControllerOptions,
): AiConsentControllerState & AiConsentControllerActions {
  const controllerRef = useRef<AiConsentController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new AiConsentController(options);
  }

  const controller = controllerRef.current;

  useEffect(() => {
    controller.updateOptions(options);
  }, [
    controller,
    options.userId,
    options.onExecuteAction,
    options.getConsent,
    options.saveConsent,
    options.revokeConsent,
    options.autoLoad,
    options.apiClient,
  ]);

  useEffect(() => {
    return () => {
      controller.destroy();
    };
  }, [controller]);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  const requestAction = useCallback(
    (action: PendingAiAction) => controller.requestAction(action),
    [controller],
  );

  const confirmConsent = useCallback(
    () => controller.confirmConsent(),
    [controller],
  );

  const declineConsent = useCallback(
    () => controller.declineConsent(),
    [controller],
  );

  const revokeConsent = useCallback(
    () => controller.revokeConsent(),
    [controller],
  );

  const retryPendingAction = useCallback(
    () => controller.retryPendingAction(),
    [controller],
  );

  return {
    ...state,
    requestAction,
    confirmConsent,
    declineConsent,
    revokeConsent,
    retryPendingAction,
  };
}
