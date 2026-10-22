import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { ApiClient, ApiError } from "@mizyun/api-client";
import {
  communityProfileDtoSchema,
  type CommunityProfileDto,
  type CreateCommunityProfileInput,
  type HandleAvailabilityResponse,
  type UpdateCommunityProfileInput,
  type WithdrawCommunityResponse,
} from "@mizyun/contracts";
import { isAdultEligibleForCommunity, type Result } from "@mizyun/core";

import {
  checkHandleAvailability,
  enrollCommunityProfile,
  communityErrorCause,
  fetchCommunityProfile,
  humanizeCommunityError,
  updateCommunityProfile,
  withdrawCommunityProfile,
} from "./community-client";
import { apiClient } from "@/composition/api-client";
import { scopeCommunityClient } from "./scoped-client";
import {
  peekCommunityRead,
  subscribeCommunityReadFills,
} from "./state/read-cache";

export type CommunityProfileStatus = "idle" | "loading" | "ready" | "error";

export interface CommunityProfileState {
  readonly status: CommunityProfileStatus;
  readonly profile: CommunityProfileDto | null;
  readonly isEnrolled: boolean;
  readonly isWithdrawn: boolean;
  readonly isAdultEligible: boolean;
  readonly error: string | null;
  readonly isSaving: boolean;
}

export interface CommunityProfileControllerOptions {
  readonly client: ApiClient;
  readonly birthYear?: number | null;
  readonly autoLoad?: boolean;
  readonly now?: () => Date;
  readonly principalKey?: string | null;
  readonly accessToken?: string | null;
  readonly isCurrentPrincipal?: () => boolean;
}

export class CommunityProfileController {
  private state: CommunityProfileState;
  private readonly client: ApiClient;
  private readonly listeners = new Set<() => void>();
  private isDestroyed = false;
  private revision = 0;
  private mutationPending = false;
  private pristine = true;
  private stopFillSubscription: (() => void) | undefined;

  constructor(private readonly options: CommunityProfileControllerOptions) {
    this.client = scopeCommunityClient(
      options.client,
      options.principalKey,
      () => this.isCurrent(),
    );
    const currentYear = options.now
      ? options.now().getUTCFullYear()
      : new Date().getUTCFullYear();
    const isAdultEligible = isAdultEligibleForCommunity(
      options.birthYear,
      currentYear,
    );

    this.state = {
      status: "idle",
      profile: null,
      isEnrolled: false,
      isWithdrawn: false,
      isAdultEligible,
      error: null,
      isSaving: false,
    };

    this.hydrateInitialSnapshot();

    if (options.autoLoad !== false) {
      void this.load();
    }
  }

  private hydrateInitialSnapshot(): boolean {
    const options = this.options;
    const retained =
      this.pristine &&
      this.state.status === "idle" &&
      this.state.isAdultEligible &&
      !this.mutationPending &&
      options.principalKey &&
      options.accessToken &&
      this.isCurrent()
        ? peekCommunityRead<CommunityProfileDto>(
            options.client,
            {
              method: "GET",
              path: "/v1/community/profile",
              schema: communityProfileDtoSchema,
              expectedUserId: options.principalKey,
            },
            {
              user: { id: options.principalKey },
              accessToken: options.accessToken,
            },
          )
        : undefined;
    if (
      retained?.status === "active" &&
      retained.userId === options.principalKey
    ) {
      this.state = {
        ...this.state,
        status: "ready",
        profile: retained,
        isEnrolled: true,
      };
      this.pristine = false;
      return true;
    }
    return false;
  }

  public getState(): CommunityProfileState {
    this.hydrateInitialSnapshot();
    return this.state;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.observeCacheFills();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopFillSubscription?.();
        this.stopFillSubscription = undefined;
      }
    };
  }

  private observeCacheFills(): void {
    if (
      this.stopFillSubscription ||
      this.isDestroyed ||
      this.listeners.size === 0
    )
      return;
    this.stopFillSubscription = subscribeCommunityReadFills(
      this.options.client,
      () => {
        if (this.hydrateInitialSnapshot())
          for (const listener of this.listeners) listener();
      },
    );
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.revision += 1;
    this.stopFillSubscription?.();
    this.stopFillSubscription = undefined;
    this.listeners.clear();
  }

  // Effects may clean up and start again in React StrictMode.
  public activate(): void {
    this.isDestroyed = false;
    this.observeCacheFills();
  }

  private isCurrent(): boolean {
    return (
      !this.isDestroyed &&
      this.options.principalKey !== null &&
      (this.options.isCurrentPrincipal?.() ?? true)
    );
  }

  private unavailable<T>(): Result<T, ApiError> {
    return { ok: false, error: { kind: "no_session" } };
  }

  private mutationError(error: ApiError): void {
    const denied =
      error.kind === "no_session" ||
      error.kind === "session_expired" ||
      (error.kind === "http_error" &&
        (error.status === 401 ||
          error.status === 403 ||
          error.status === 404 ||
          error.code === "COMMUNITY_NOT_ENROLLED" ||
          error.code === "COMMUNITY_AGE_RESTRICTED"));
    this.updateState({
      error: humanizeCommunityError(error),
      isSaving: false,
      ...(denied ||
      error.kind === "network_error" ||
      error.kind === "parse_error" ||
      error.kind === "validation_error"
        ? {
            profile: null,
            isEnrolled: false,
            isWithdrawn: false,
            status: "error" as const,
          }
        : {}),
    });
  }

  private updateState(patch: Partial<CommunityProfileState>): void {
    if (!this.isCurrent()) {
      return;
    }
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  public async load(): Promise<void> {
    if (!this.isCurrent() || this.mutationPending) return;
    this.pristine = false;
    const revision = ++this.revision;
    this.updateState({
      status: "loading",
      error: null,
      profile: null,
      isEnrolled: false,
      isWithdrawn: false,
      isAdultEligible: isAdultEligibleForCommunity(
        this.options.birthYear,
        (this.options.now?.() ?? new Date()).getUTCFullYear(),
      ),
    });

    const result = await fetchCommunityProfile(this.client);
    if (!this.isCurrent() || revision !== this.revision) return;

    if (result.ok) {
      const profile = result.value;
      this.updateState({
        status: "ready",
        profile,
        isEnrolled: profile.status === "active" && this.state.isAdultEligible,
        isWithdrawn: profile.status === "withdrawn",
        error: null,
      });
      return;
    }

    // Only the explicit absence response establishes an unenrolled state. The
    // read cache retires its own failed read and keeps the response as the
    // cause; this load's revision check above already rejects a stale one.
    const cause = communityErrorCause(result.error);
    if (
      cause.kind === "http_error" &&
      cause.code === "COMMUNITY_NOT_ENROLLED"
    ) {
      this.updateState({
        status: "ready",
        profile: null,
        isEnrolled: false,
        isWithdrawn: false,
        error: null,
      });
      return;
    }

    this.updateState({
      status: "error",
      profile: null,
      isEnrolled: false,
      isWithdrawn: false,
      error: humanizeCommunityError(result.error),
    });
  }

  public async enroll(
    input: CreateCommunityProfileInput,
  ): Promise<Result<CommunityProfileDto, ApiError>> {
    if (
      !this.isCurrent() ||
      this.mutationPending ||
      this.state.status === "error"
    )
      return this.unavailable();
    const currentYear = this.options.now
      ? this.options.now().getUTCFullYear()
      : new Date().getUTCFullYear();
    const isAdultEligible = isAdultEligibleForCommunity(
      this.options.birthYear,
      currentYear,
    );

    if (!isAdultEligible) {
      const error: ApiError = {
        kind: "http_error",
        status: 403,
        code: "COMMUNITY_AGE_RESTRICTED",
        message:
          "We cannot confirm Community eligibility from your birth year. Your private tracking stays available.",
      };
      this.updateState({
        error: humanizeCommunityError(error),
      });
      return { ok: false, error };
    }

    const revision = ++this.revision;
    this.mutationPending = true;
    this.pristine = false;
    this.updateState({ error: null, isSaving: true });
    const result = await enrollCommunityProfile(this.client, input);
    this.mutationPending = false;
    if (!this.isCurrent() || revision !== this.revision)
      return this.unavailable();

    if (result.ok) {
      this.updateState({
        status: "ready",
        isSaving: false,
        profile: result.value,
        isEnrolled: result.value.status === "active" && isAdultEligible,
        isWithdrawn: false,
        error: null,
      });
    } else {
      this.mutationError(result.error);
    }

    return result;
  }

  public async update(
    input: UpdateCommunityProfileInput,
  ): Promise<Result<CommunityProfileDto, ApiError>> {
    if (
      !this.isCurrent() ||
      this.mutationPending ||
      this.state.status === "error"
    )
      return this.unavailable();
    const revision = ++this.revision;
    this.mutationPending = true;
    this.pristine = false;
    this.updateState({ error: null, isSaving: true });
    const result = await updateCommunityProfile(this.client, input);
    this.mutationPending = false;
    if (!this.isCurrent() || revision !== this.revision)
      return this.unavailable();

    if (result.ok) {
      this.updateState({
        status: "ready",
        isSaving: false,
        profile: result.value,
        isEnrolled:
          result.value.status === "active" && this.state.isAdultEligible,
        isWithdrawn: result.value.status === "withdrawn",
        error: null,
      });
    } else {
      this.mutationError(result.error);
    }

    return result;
  }

  public async withdraw(): Promise<
    Result<WithdrawCommunityResponse, ApiError>
  > {
    if (!this.isCurrent() || this.mutationPending) return this.unavailable();
    const revision = ++this.revision;
    this.mutationPending = true;
    this.pristine = false;
    this.updateState({ error: null, isSaving: true });
    const result = await withdrawCommunityProfile(this.client);
    this.mutationPending = false;
    if (!this.isCurrent() || revision !== this.revision)
      return this.unavailable();

    if (result.ok) {
      const currentProfile = this.state.profile;
      this.updateState({
        status: "ready",
        isSaving: false,
        profile: currentProfile
          ? {
              ...currentProfile,
              status:
                currentProfile.status === "suspended"
                  ? "suspended"
                  : "withdrawn",
              isSearchable: false,
              updatedAt: new Date().toISOString(),
            }
          : null,
        isEnrolled: false,
        isWithdrawn: currentProfile?.status !== "suspended",
        error: null,
      });
    } else {
      this.mutationError(result.error);
    }

    return result;
  }

  public async checkHandle(
    handle: string,
  ): Promise<Result<HandleAvailabilityResponse, ApiError>> {
    if (!this.isCurrent()) return this.unavailable();
    return checkHandleAvailability(this.client, handle);
  }
}

export function useCommunityProfile(
  options?: Partial<CommunityProfileControllerOptions>,
): CommunityProfileState & {
  state: CommunityProfileState;
  actions: {
    load: () => Promise<void>;
    enroll: (
      input: CreateCommunityProfileInput,
    ) => Promise<Result<CommunityProfileDto, ApiError>>;
    update: (
      input: UpdateCommunityProfileInput,
    ) => Promise<Result<CommunityProfileDto, ApiError>>;
    withdraw: () => Promise<Result<WithdrawCommunityResponse, ApiError>>;
    checkHandle: (
      handle: string,
    ) => Promise<Result<HandleAvailabilityResponse, ApiError>>;
  };
} {
  const principalKey = options?.principalKey ?? null;
  const currentController = useRef<CommunityProfileController | null>(null);
  const client = options?.client ?? apiClient;
  const birthYear = options?.birthYear;
  const now = options?.now;
  const autoLoad = options?.autoLoad !== false;
  const accessToken = options?.accessToken;
  const controller = useMemo(() => {
    // During construction these synchronous props identify the new controller;
    // once initialized, requests must also match the active controller instance.
    let initializing = true;
    const next: CommunityProfileController = new CommunityProfileController({
      client,
      birthYear,
      now,
      autoLoad: false,
      principalKey,
      accessToken,
      isCurrentPrincipal: (): boolean =>
        initializing || currentController.current === next,
    });
    initializing = false;
    return next;
  }, [client, birthYear, now, principalKey, accessToken]);
  currentController.current = controller;

  useEffect(() => {
    controller.activate();
    if (autoLoad && principalKey !== null) void controller.load();
    return () => controller.destroy();
  }, [controller, autoLoad, principalKey]);

  const state = useSyncExternalStore(
    (callback) => controller.subscribe(callback),
    () => controller.getState(),
  );

  const load = useCallback(() => controller.load(), [controller]);
  const enroll = useCallback(
    (input: CreateCommunityProfileInput) => controller.enroll(input),
    [controller],
  );
  const update = useCallback(
    (input: UpdateCommunityProfileInput) => controller.update(input),
    [controller],
  );
  const withdraw = useCallback(() => controller.withdraw(), [controller]);
  const checkHandle = useCallback(
    (handle: string) => controller.checkHandle(handle),
    [controller],
  );

  return {
    ...state,
    state,
    actions: {
      load,
      enroll,
      update,
      withdraw,
      checkHandle,
    },
  };
}
