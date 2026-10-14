import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  createRecurringMealSuggestionApi,
  type ApiClient,
  type ApiError,
  type RecurringMealSuggestionApi,
} from "@mizyun/api-client";
import {
  recurringMealSuggestionAcceptSchema,
  type RecurringMealSuggestionProposal,
  type RecurringMealSuggestionAccept,
  type RecurringMealSuggestionAcceptResponse,
} from "@mizyun/contracts";
import { apiClient, invalidateSessionReads } from "@/composition/api-client";
import { subscribeSessionReadUpdates } from "@/composition/personal-read-events";
import { createOperationId } from "@/features/log-meal/public-data";
import {
  deviceTimeZone,
  stopSchedule,
  loadSchedules,
} from "./recurring-meal-data";
import {
  recurringSuggestionLifetime,
  subscribeRecurringSuggestionRetirement,
  isRecurringSuggestionOwnerActive,
} from "./recurring-meal-suggestion-lifetime";
import {
  getRecurringSuggestionRetryStore,
  type RecurringSuggestionRetryStore,
} from "./recurring-meal-suggestion-retry";

export interface RecurringMealSuggestionTimeZones {
  readonly device: string;
  readonly profile: string | null;
}

export interface RecurringMealSuggestionState {
  readonly timezoneChoice?: RecurringMealSuggestionTimeZones;
  readonly candidate: RecurringMealSuggestionProposal | null;
  readonly status:
    | "idle"
    | "loading"
    | "ready"
    | "timezone-choice"
    | "pending"
    | "unknown"
    | "success"
    | "already-scheduled"
    | "stale"
    | "error";
  readonly result: RecurringMealSuggestionAcceptResponse | null;
  readonly error: string | null;
}
const empty = (): RecurringMealSuggestionState => ({
  candidate: null,
  status: "idle",
  result: null,
  error: null,
});
const message = (error: ApiError): string => {
  if (error.kind === "http_error" && [404, 409, 422].includes(error.status))
    return "This suggestion changed. Refresh it before enabling automatic logging.";
  if (error.kind === "no_session" || error.kind === "session_expired")
    return "Sign in again to manage automatic logging.";
  return "Could not confirm automatic logging. Retry this same setup when your connection is available.";
};
const definitive = (error: ApiError): boolean =>
  error.kind === "http_error" &&
  [400, 403, 404, 409, 422].includes(error.status);

/** One owner controller is shared by Home/Meals. The encrypted operation survives restart. */
export class RecurringMealSuggestionController {
  private value: RecurringMealSuggestionState = empty();
  private listeners = new Set<(state: RecurringMealSuggestionState) => void>();
  private busy = false;
  private refreshPending: Promise<void> | null = null;
  private shown = new Set<string>();
  private readonly revision: number;
  private readonly api: RecurringMealSuggestionApi;
  private profileOverride: string | null | undefined;
  private selectedZone:
    (RecurringMealSuggestionTimeZones & { chosen: string }) | null = null;
  constructor(
    readonly owner: string,
    readonly client: ApiClient,
    readonly store: () => Promise<RecurringSuggestionRetryStore>,
    readonly timeZone: () => string = deviceTimeZone,
    readonly ownerActive: () => boolean = () => true,
    readonly profileTimeZone: () => string | null = timeZone,
  ) {
    this.revision = recurringSuggestionLifetime(owner);
    this.api = createRecurringMealSuggestionApi(client);
  }
  setProfileTimeZone(zone: string | null): void {
    this.profileOverride = zone;
  }
  private zones(): RecurringMealSuggestionTimeZones {
    return {
      device: this.timeZone(),
      profile:
        this.profileOverride === undefined
          ? this.profileTimeZone()
          : this.profileOverride,
    };
  }
  private detectionZone(): string | null {
    const zones = this.zones();
    if (zones.device === zones.profile) return zones.device;
    return this.selectedZone?.device === zones.device &&
      this.selectedZone.profile === zones.profile
      ? this.selectedZone.chosen
      : null;
  }
  private holdForTimezone(): void {
    this.publish({
      ...empty(),
      status: "timezone-choice",
      timezoneChoice: this.zones(),
    });
  }
  async chooseTimeZone(zone: string): Promise<void> {
    if (
      !this.current() ||
      this.busy ||
      ["unknown", "pending", "success", "already-scheduled"].includes(
        this.value.status,
      )
    )
      return;
    const zones = this.zones();
    if (zone !== zones.device && zone !== zones.profile) return;
    this.selectedZone = { ...zones, chosen: zone };
    await this.refresh();
  }
  readonly current = (): boolean =>
    this.ownerActive() &&
    this.revision === recurringSuggestionLifetime(this.owner);
  private lifetime() {
    return { expectedUserId: this.owner, isCurrent: this.current };
  }
  get state(): RecurringMealSuggestionState {
    return this.current() ? this.value : empty();
  }
  subscribe(
    listener: (state: RecurringMealSuggestionState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(value: RecurringMealSuggestionState): void {
    if (!this.current()) return;
    this.value = value;
    for (const listener of this.listeners) listener(value);
  }
  private update(patch: Partial<RecurringMealSuggestionState>): void {
    this.publish({ ...this.value, ...patch });
  }
  async refresh(afterCurrent = false): Promise<void> {
    const pending = this.refreshPending;
    if (pending) {
      await pending;
      if (!afterCurrent) return;
    }
    if (!this.current() || this.busy) return;
    const task = this.refreshNow();
    this.refreshPending = task;
    try {
      await task;
    } finally {
      if (this.refreshPending === task) this.refreshPending = null;
    }
  }
  private async refreshNow(): Promise<void> {
    if (!this.current() || this.busy) return;
    this.busy = true;
    try {
      const recovery = await (await this.store()).load(this.owner);
      if (!this.current()) return;
      if (recovery) {
        if (
          recovery.completed &&
          Date.now() - recovery.savedAt > 7 * 86_400_000
        ) {
          await (
            await this.store()
          ).clear(this.owner, recovery.input.operationId);
        } else {
          if (recovery.completed) {
            await this.refreshCompleted(recovery.input, recovery.completed);
            return;
          }
          this.publish({
            candidate: recovery.input.proposal,
            status: "unknown",
            result: null,
            error:
              "A previous setup needs confirmation. Retry the same setup to recover its result.",
          });
          return;
        }
      }
      if (!this.current()) return;
      // Establish eligibility first so a timezone disagreement alone never
      // prompts users who disabled suggestions or have no repeated meal.
      const timeZone = this.detectionZone() ?? this.zones().device;
      this.publish({ ...empty(), status: "loading" });
      const result = await this.api.list(timeZone, this.lifetime());
      if (!this.current()) return;
      if (!result.ok) {
        // Detection is optional; do not replace a successfully saved meal with an error.
        this.publish(empty());
        return;
      }
      if (
        result.value.suggestion &&
        result.value.suggestion.timeZone !== timeZone
      ) {
        this.publish({
          ...empty(),
          status: "stale",
          error: "Refresh this suggestion in the selected timezone.",
        });
        return;
      }
      if (!result.value.enabled || !result.value.suggestion) {
        this.publish(empty());
        return;
      }
      const selectedTimeZone = this.detectionZone();
      if (!selectedTimeZone) {
        this.holdForTimezone();
        return;
      }
      if (selectedTimeZone !== timeZone) {
        this.publish({
          ...empty(),
          status: "stale",
          error:
            "Your timezone changed. Refresh the suggestion before enabling it.",
        });
        return;
      }
      const zones = this.zones();
      this.publish({
        ...(zones.device !== zones.profile ? { timezoneChoice: zones } : {}),
        candidate: result.value.suggestion,
        status:
          result.value.enabled && result.value.suggestion ? "ready" : "idle",
        result: null,
        error: null,
      });
    } catch {
      this.publish({
        ...empty(),
        status: "error",
        error:
          "Could not read setup recovery. Try again when device storage is available.",
      });
    } finally {
      this.busy = false;
    }
  }
  async markShown(isVisible: () => boolean = () => true): Promise<void> {
    const proposal = this.value.candidate;
    if (
      !proposal ||
      !isVisible() ||
      this.detectionZone() !== proposal.timeZone ||
      this.value.status !== "ready" ||
      this.shown.has(proposal.candidateId) ||
      !this.current()
    )
      return;
    this.shown.add(proposal.candidateId);
    const response = await this.api.decide(
      { proposal, decision: "shown" },
      {
        expectedUserId: this.owner,
        isCurrent: () => this.current() && isVisible(),
      },
    );
    if (!response.ok) this.shown.delete(proposal.candidateId);
  }
  private async refreshCompleted(
    input: RecurringMealSuggestionAccept,
    completed: RecurringMealSuggestionAcceptResponse,
  ): Promise<void> {
    const current = await loadSchedules(this.lifetime(), this.client);
    if (!this.current()) return;
    if (!current.ok) {
      this.publish({
        ...empty(),
        status: "error",
        error:
          "Could not refresh this schedule. Retry when your connection is available.",
      });
      return;
    }
    const schedule = current.recurringMeals.find(
      (row) =>
        row.id === completed.recurringMeal.id && row.userId === this.owner,
    );
    if (!schedule) {
      await (await this.store()).clear(this.owner, input.operationId);
      this.publish(empty());
      return;
    }
    this.publish({
      candidate: input.proposal,
      status: completed.created ? "success" : "already-scheduled",
      result: { ...completed, recurringMeal: schedule },
      error: null,
    });
  }
  async accept(overrides?: {
    localTime: string;
    weekdays: number[];
  }): Promise<void> {
    if (
      !this.current() ||
      this.busy ||
      !this.value.candidate ||
      !["ready", "error"].includes(this.value.status)
    )
      return;
    const proposal = this.value.candidate;
    const timeZone = this.detectionZone();
    if (!timeZone) {
      this.holdForTimezone();
      return;
    }
    if (proposal.timeZone !== timeZone) {
      this.publish({
        ...empty(),
        status: "stale",
        error:
          "Your timezone changed. Refresh the suggestion before enabling it.",
      });
      return;
    }
    const input = recurringMealSuggestionAcceptSchema.safeParse({
      operationId: createOperationId(),
      proposal,
      localTime: overrides?.localTime ?? proposal.localTime,
      timeZone: proposal.timeZone,
      weekdays: overrides?.weekdays ?? proposal.weekdays,
    });
    if (!input.success) {
      this.update({
        error: "Choose a valid time and at least one day.",
        status: "error",
      });
      return;
    }
    this.busy = true;
    this.update({ status: "pending", error: null });
    try {
      const recovery = await (
        await this.store()
      ).prepare(this.owner, input.data, this.current);
      if (this.current()) await this.submit(recovery.input);
    } catch {
      if (this.current()) {
        try {
          const recovery = await (await this.store()).load(this.owner);
          this.update({
            status: recovery ? "unknown" : "error",
            error: recovery
              ? "Resolve the saved setup with Retry before starting another."
              : "Could not save setup recovery. No request was sent; try again when device storage is available.",
          });
        } catch {
          this.update({
            status: "unknown",
            error:
              "Setup recovery could not be read safely. Try Retry when device storage is available.",
          });
        }
      }
    } finally {
      this.busy = false;
    }
  }
  private async submit(input: RecurringMealSuggestionAccept): Promise<void> {
    if (!this.current()) return;
    invalidateSessionReads();
    let result;
    try {
      result = await this.api.accept(input, this.lifetime());
    } finally {
      invalidateSessionReads();
    }
    if (!this.current()) return;
    if (result.ok) {
      await (await this.store()).complete(this.owner, input, result.value);
      this.publish({
        candidate: input.proposal,
        status: result.value.created ? "success" : "already-scheduled",
        result: result.value,
        error: null,
      });
    } else if (definitive(result.error)) {
      await (await this.store()).clear(this.owner, input.operationId);
      this.update({
        status: "stale",
        result: null,
        error: message(result.error),
      });
    } else {
      this.update({ status: "unknown", error: message(result.error) });
    }
  }
  async retry(): Promise<void> {
    if (!this.current() || this.busy) return;
    this.busy = true;
    this.update({ status: "pending", error: null });
    try {
      const recovery = await (await this.store()).load(this.owner);
      if (!recovery) {
        this.update({
          status: "stale",
          error: "No saved setup remains. Refresh before enabling it.",
        });
        return;
      }
      if (!this.current()) return;
      if (recovery.completed)
        await this.refreshCompleted(recovery.input, recovery.completed);
      else await this.submit(recovery.input);
    } catch {
      this.update({
        status: "unknown",
        error:
          "The result is still unknown. Keep this setup and retry when storage and connection are available.",
      });
    } finally {
      this.busy = false;
    }
  }
  async dismiss(permanent: boolean): Promise<void> {
    if (
      !this.current() ||
      this.busy ||
      !this.value.candidate ||
      !["ready", "error"].includes(this.value.status)
    )
      return;
    const proposal = this.value.candidate;
    this.busy = true;
    this.update({ status: "pending", error: null });
    try {
      const result = await this.api.decide(
        { proposal, decision: permanent ? "never" : "not_now" },
        this.lifetime(),
      );
      if (result.ok) this.publish(empty());
      else
        this.update({
          status: definitive(result.error) ? "stale" : "error",
          error: "Could not save that preference. Please retry.",
        });
    } catch {
      this.update({
        status: "error",
        error: "Could not save that preference. Please retry.",
      });
    } finally {
      this.busy = false;
    }
  }
  async undo(): Promise<void> {
    const result = this.value.result;
    if (!this.current() || this.busy || !result?.created) return;
    this.busy = true;
    this.update({ status: "pending", error: null });
    try {
      const stopped = await stopSchedule(
        result.recurringMeal.id,
        this.lifetime(),
        this.client,
      );
      if (!this.current()) return;
      if (!stopped.ok) {
        this.update({ status: "success", error: stopped.message });
        return;
      }
      await (await this.store()).clear(this.owner);
      this.publish(empty());
    } catch {
      this.update({
        status: "success",
        error: "Could not confirm Undo. Retry Undo or manage this schedule.",
      });
    } finally {
      this.busy = false;
    }
  }
}

const controllers = new Map<string, RecurringMealSuggestionController>();
subscribeRecurringSuggestionRetirement((owner) => controllers.delete(owner));
const controllerFor = (owner: string, profileTimeZone: string | null) => {
  let controller = controllers.get(owner);
  if (!controller) {
    controller = new RecurringMealSuggestionController(
      owner,
      apiClient,
      getRecurringSuggestionRetryStore,
      deviceTimeZone,
      () => isRecurringSuggestionOwnerActive(owner),
    );
    controllers.set(owner, controller);
  }
  controller.setProfileTimeZone(profileTimeZone);
  return controller;
};
export function useRecurringMealSuggestion(
  userId: string | null,
  options: { visible?: boolean; profileTimeZone?: string | null } = {},
) {
  const controller = userId
    ? controllerFor(userId, options.profileTimeZone ?? null)
    : null;
  const [state, setState] = useState<RecurringMealSuggestionState>(
    controller?.state ?? empty(),
  );
  const focused = useRef(false);
  const visible = options.visible !== false;
  const foregroundReady = useRef(AppState.currentState === "active");
  const activation = useRef(0);
  const [, setAppEpoch] = useState(0);
  const actionable = () =>
    visible &&
    focused.current &&
    foregroundReady.current &&
    AppState.currentState === "active";
  useEffect(() => {
    let mounted = true;
    const refreshForeground = () => {
      const capturedActivation = ++activation.current;
      foregroundReady.current = false;
      setAppEpoch((n) => n + 1);
      if (AppState.currentState !== "active" || !visible || !focused.current)
        return;
      void controller?.refresh(true).finally(() => {
        if (
          !mounted ||
          capturedActivation !== activation.current ||
          AppState.currentState !== "active" ||
          !controller.current()
        )
          return;
        foregroundReady.current = true;
        setAppEpoch((n) => n + 1);
      });
    };
    const subscription = AppState.addEventListener("change", refreshForeground);
    return () => {
      mounted = false;
      activation.current++;
      subscription.remove();
    };
  }, [controller, visible]);
  useEffect(() => {
    setState(controller?.state ?? empty());
    if (!controller) return;
    const unsubscribe = controller.subscribe(setState);
    const retirement = subscribeRecurringSuggestionRetirement((owner) => {
      if (owner === userId) setState(empty());
    });
    return () => {
      unsubscribe();
      retirement();
    };
  }, [controller, userId]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const capturedActivation = ++activation.current;
      let mounted = true;
      if (visible && AppState.currentState === "active") {
        foregroundReady.current = false;
        void controller?.refresh(true).finally(() => {
          if (
            !mounted ||
            capturedActivation !== activation.current ||
            AppState.currentState !== "active" ||
            !controller.current()
          )
            return;
          foregroundReady.current = true;
          setAppEpoch((n) => n + 1);
        });
      }
      const unsubscribe = subscribeSessionReadUpdates((path) => {
        if (
          actionable() &&
          (path.startsWith("/v1/food-entries") ||
            path.startsWith("/v1/recurring-meals"))
        )
          void controller?.refresh();
      });
      return () => {
        mounted = false;
        activation.current++;
        focused.current = false;
        unsubscribe();
      };
    }, [controller, visible, options.profileTimeZone]),
  );
  useEffect(() => {
    if (actionable() && state.status === "ready")
      void controller?.markShown(actionable);
  });
  // Never paint an old principal while effects catch up with a prop change.
  const display = !actionable()
    ? empty()
    : controller && controller.current() && state === controller.state
      ? state
      : (controller?.state ?? empty());
  return {
    ...display,
    accept: (overrides?: { localTime: string; weekdays: number[] }) =>
      actionable()
        ? (controller?.accept(overrides) ?? Promise.resolve())
        : Promise.resolve(),
    dismiss: (permanent: boolean) =>
      actionable()
        ? (controller?.dismiss(permanent) ?? Promise.resolve())
        : Promise.resolve(),
    chooseTimeZone: (zone: string) =>
      actionable()
        ? (controller?.chooseTimeZone(zone) ?? Promise.resolve())
        : Promise.resolve(),
    refresh: () => controller?.refresh() ?? Promise.resolve(),
    retry: () =>
      actionable()
        ? (controller?.retry() ?? Promise.resolve())
        : Promise.resolve(),
    undo: () =>
      actionable()
        ? (controller?.undo() ?? Promise.resolve())
        : Promise.resolve(),
  };
}
