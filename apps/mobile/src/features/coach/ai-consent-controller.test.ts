import { describe, expect, it, vi } from "vitest";

import { CURRENT_AI_CONSENT_VERSION } from "@mizyun/contracts";

import { loadAiConsent } from "./ai-consent";
import {
  AiConsentController,
  createAiConsentController,
  PendingAiAction,
  useAiConsentController,
} from "./ai-consent-controller";

// Lightweight renderHook harness for testing React hooks in node vitest
function renderHook<P, R>(hookFn: (props: P) => R, initialProps: P) {
  let hookIndex = 0;
  const hooks: unknown[] = [];
  const effects: Array<{ idx: number; effectFn: () => void | (() => void) }> =
    [];
  const cleanups: Array<(() => void) | void> = [];
  let currentProps = initialProps;

  // React 19 dispatcher interface
  const dispatcher = {
    useRef<T>(initialValue: T) {
      const idx = hookIndex++;
      if (hooks[idx] === undefined) {
        hooks[idx] = { current: initialValue };
      }
      return hooks[idx] as { current: T };
    },
    useCallback<T extends (...args: unknown[]) => unknown>(
      fn: T,
      _deps: unknown[],
    ) {
      hookIndex++;
      return fn;
    },
    useEffect(effectFn: () => void | (() => void), deps?: unknown[]) {
      const idx = hookIndex++;
      const prevDeps = hooks[idx] as unknown[] | undefined;
      let hasChanged = true;
      if (prevDeps && deps) {
        hasChanged = deps.some((d, i) => !Object.is(d, prevDeps[i]));
      }
      hooks[idx] = deps;
      if (hasChanged) {
        effects.push({ idx, effectFn });
      }
    },
    useSyncExternalStore<Snapshot>(
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => Snapshot,
    ) {
      const idx = hookIndex++;
      if (hooks[idx] === undefined) {
        hooks[idx] = {
          unsub: subscribe(() => {
            render();
          }),
        };
      }
      return getSnapshot();
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ReactInternals =
    (globalThis as any).React
      ?.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ??
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react")
      .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

  function render(newProps?: P): R {
    if (newProps !== undefined) {
      currentProps = newProps;
    }
    hookIndex = 0;
    const prevDispatcher = ReactInternals.H;
    ReactInternals.H = dispatcher;
    let hookResult: R;
    try {
      hookResult = hookFn(currentProps);
      if (result) {
        result.current = hookResult;
      }
    } finally {
      ReactInternals.H = prevDispatcher;
    }
    while (effects.length > 0) {
      const entry = effects.shift();
      if (entry) {
        if (cleanups[entry.idx]) {
          cleanups[entry.idx]!();
        }
        cleanups[entry.idx] = entry.effectFn();
      }
    }
    return hookResult;
  }

  const result = { current: null as unknown as R };
  result.current = render();

  return {
    result,
    rerender: (newProps?: P) => {
      render(newProps);
    },
    unmount: () => {
      for (const cleanup of cleanups) {
        if (typeof cleanup === "function") {
          cleanup();
        }
      }
    },
  };
}

describe("ai-consent-controller", () => {
  describe("1. Initial load & state machine", () => {
    it("sets status to ready when consent is already granted and adult is confirmed", async () => {
      const getConsent = vi.fn().mockResolvedValue({
        granted: true,
        confirmedAdult: true,
      });

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent,
      });

      expect(controller.getState().status).toBe("loading");
      await controller.waitForLoad();

      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.consentGranted).toBe(true);
      expect(state.confirmedAdult).toBe(true);
      expect(state.error).toBeNull();
      expect(state.isModalVisible).toBe(false);
      expect(getConsent).toHaveBeenCalledWith("user-1");
    });

    it("sets status to ready (with consentGranted: false) when consent is not granted", async () => {
      const getConsent = vi.fn().mockResolvedValue({
        granted: false,
        confirmedAdult: false,
      });

      const controller = createAiConsentController({
        userId: "user-2",
        getConsent,
      });

      await controller.waitForLoad();

      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.consentGranted).toBe(false);
      expect(state.confirmedAdult).toBe(false);
      expect(state.error).toBeNull();
      expect(state.isModalVisible).toBe(false);
    });

    it("handles null userId (signed out) by remaining ready without loading", async () => {
      const getConsent = vi.fn();

      const controller = createAiConsentController({
        userId: null,
        getConsent,
      });

      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.consentGranted).toBe(false);
      expect(state.confirmedAdult).toBe(false);
      expect(getConsent).not.toHaveBeenCalled();
    });

    it("transitions to error state when getConsent rejects", async () => {
      const getConsent = vi
        .fn()
        .mockRejectedValue(new Error("Storage corrupted"));

      const controller = createAiConsentController({
        userId: "user-3",
        getConsent,
      });

      await controller.waitForLoad();

      const state = controller.getState();
      expect(state.status).toBe("error");
      expect(state.error).toBe("Failed to load AI consent.");
      expect(state.consentGranted).toBe(false);
      expect(state.confirmedAdult).toBe(false);
    });
  });

  describe("2. requestAction with pre-existing consent", () => {
    it("executes immediately without showing modal when consent is already granted", async () => {
      const onExecuteAction = vi.fn();
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: true, confirmedAdult: true }),
        onExecuteAction,
      });

      await controller.waitForLoad();

      const action: PendingAiAction = {
        kind: "coach_message",
        text: "How much protein do I need?",
        idempotencyKey: "key-1",
      };

      await controller.requestAction(action);

      expect(onExecuteAction).toHaveBeenCalledTimes(1);
      expect(onExecuteAction).toHaveBeenCalledWith(action);
      expect(controller.getState().status).toBe("ready");
      expect(controller.getState().isModalVisible).toBe(false);
      expect(controller.getState().pendingAction).toBeNull();
    });

    it("does nothing when userId is null", async () => {
      const onExecuteAction = vi.fn();
      const controller = createAiConsentController({
        userId: null,
        onExecuteAction,
      });

      await controller.requestAction({
        kind: "coach_message",
        text: "Hello",
      });

      expect(onExecuteAction).not.toHaveBeenCalled();
      expect(controller.getState().pendingAction).toBeNull();
      expect(controller.getState().isModalVisible).toBe(false);
    });

    it("prevents duplicate execution when rapid calls occur while an action is executing", async () => {
      let resolveAction!: () => void;
      const deferredPromise = new Promise<void>((resolve) => {
        resolveAction = resolve;
      });

      const onExecuteAction = vi.fn().mockImplementation(() => deferredPromise);

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: true, confirmedAdult: true }),
        onExecuteAction,
      });
      await controller.waitForLoad();

      const action1: PendingAiAction = {
        kind: "coach_message",
        text: "Message 1",
      };
      const action2: PendingAiAction = {
        kind: "coach_message",
        text: "Message 2",
      };

      // Call action1 and immediate concurrent action2
      const p1 = controller.requestAction(action1);
      const p2 = controller.requestAction(action2);

      // action2 should be dropped by execution lock
      expect(onExecuteAction).toHaveBeenCalledTimes(1);
      expect(onExecuteAction).toHaveBeenCalledWith(action1);

      resolveAction();
      await Promise.all([p1, p2]);

      // After lock is released, subsequent action works
      const action3: PendingAiAction = {
        kind: "coach_message",
        text: "Message 3",
      };
      await controller.requestAction(action3);
      expect(onExecuteAction).toHaveBeenCalledTimes(2);
      expect(onExecuteAction).toHaveBeenLastCalledWith(action3);
    });
  });

  describe("3. requestAction without consent (pending action capture)", () => {
    it("sets status to required and stores pending action without executing", async () => {
      const onExecuteAction = vi.fn();
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        onExecuteAction,
      });

      await controller.waitForLoad();

      const action: PendingAiAction = {
        kind: "meal_text_draft",
        text: "Oatmeal with almonds and banana",
      };

      await controller.requestAction(action);

      expect(onExecuteAction).not.toHaveBeenCalled();
      const state = controller.getState();
      expect(state.status).toBe("required");
      expect(state.isModalVisible).toBe(true);
      expect(state.pendingAction).toEqual(action);
    });

    it("supports all 5 typed PendingAiAction variants correctly", async () => {
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
      });
      await controller.waitForLoad();

      const actions: PendingAiAction[] = [
        {
          kind: "coach_message",
          text: "Plan my leg day",
          idempotencyKey: "k-1",
        },
        {
          kind: "coach_photo",
          photoUri: "file:///photo.jpg",
          idempotencyKey: "k-2",
        },
        {
          kind: "meal_text_draft",
          text: "Steak and sweet potato",
        },
        {
          kind: "meal_photo_draft",
          photoUri: "file:///meal.jpg",
        },
        {
          kind: "meal_refine_draft",
          instruction: "Add 10g olive oil",
        },
      ];

      for (const action of actions) {
        await controller.requestAction(action);
        expect(controller.getState().pendingAction).toEqual(action);
        expect(controller.getState().status).toBe("required");
      }
    });

    it("requires consent if granted is true but confirmedAdult is false", async () => {
      const onExecuteAction = vi.fn();
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: true, confirmedAdult: false }),
        onExecuteAction,
      });
      await controller.waitForLoad();

      await controller.requestAction({
        kind: "meal_text_draft",
        text: "Chicken breast",
      });

      expect(onExecuteAction).not.toHaveBeenCalled();
      expect(controller.getState().status).toBe("required");
      expect(controller.getState().isModalVisible).toBe(true);
    });
  });

  describe("4. confirmConsent and double-accept lock", () => {
    it("saves consent, transitions to ready, and dispatches pending action once", async () => {
      const saveConsent = vi.fn().mockResolvedValue(true);
      const onExecuteAction = vi.fn();

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
        onExecuteAction,
      });
      await controller.waitForLoad();

      const action: PendingAiAction = {
        kind: "coach_photo",
        photoUri: "file:///gym.jpg",
      };
      await controller.requestAction(action);

      await controller.confirmConsent();

      expect(saveConsent).toHaveBeenCalledTimes(1);
      expect(saveConsent).toHaveBeenCalledWith("user-1", true, true);

      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.consentGranted).toBe(true);
      expect(state.confirmedAdult).toBe(true);
      expect(state.pendingAction).toBeNull();
      expect(state.isModalVisible).toBe(false);

      expect(onExecuteAction).toHaveBeenCalledTimes(1);
      expect(onExecuteAction).toHaveBeenCalledWith(action);
    });

    it("verifies double-accept lock: rapid taps call saveConsent once and execute once", async () => {
      let resolveSave!: (val: boolean) => void;
      const savePromise = new Promise<boolean>((resolve) => {
        resolveSave = resolve;
      });

      const saveConsent = vi.fn().mockImplementation(() => savePromise);
      const onExecuteAction = vi.fn();

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
        onExecuteAction,
      });
      await controller.waitForLoad();

      const action: PendingAiAction = {
        kind: "meal_text_draft",
        text: "Salmon bowl",
      };
      await controller.requestAction(action);

      // Simulate double tap on Accept button
      const tap1 = controller.confirmConsent();
      const tap2 = controller.confirmConsent();

      // State is saving
      expect(controller.getState().status).toBe("saving");
      expect(saveConsent).toHaveBeenCalledTimes(1);

      // Resolve save
      resolveSave(true);
      await Promise.all([tap1, tap2]);

      expect(saveConsent).toHaveBeenCalledTimes(1);
      expect(onExecuteAction).toHaveBeenCalledTimes(1);
      expect(onExecuteAction).toHaveBeenCalledWith(action);
      expect(controller.getState().status).toBe("ready");
    });

    it("clears pendingAction before invoking onExecuteAction", async () => {
      let pendingDuringExecution: PendingAiAction | null =
        undefined as unknown as PendingAiAction | null;

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent: async () => true,
        onExecuteAction: () => {
          pendingDuringExecution = controller.getState().pendingAction;
        },
      });
      await controller.waitForLoad();

      await controller.requestAction({
        kind: "meal_text_draft",
        text: "Protein bar",
      });
      await controller.confirmConsent();

      expect(pendingDuringExecution).toBeNull();
    });
  });

  describe("5. confirmConsent failure and retry", () => {
    it("transitions to error state, preserves pending action, keeps isModalVisible true, and allows retry", async () => {
      let saveOutcome = false;
      const saveConsent = vi.fn().mockImplementation(async () => saveOutcome);
      const onExecuteAction = vi.fn();

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
        onExecuteAction,
      });
      await controller.waitForLoad();

      const action: PendingAiAction = {
        kind: "meal_photo_draft",
        photoUri: "file:///salad.jpg",
      };
      await controller.requestAction(action);

      // Attempt 1: save fails
      await controller.confirmConsent();

      expect(saveConsent).toHaveBeenCalledTimes(1);
      expect(onExecuteAction).not.toHaveBeenCalled();

      let state = controller.getState();
      expect(state.status).toBe("error");
      expect(state.error).toBe("Failed to save AI consent. Please try again.");
      expect(state.pendingAction).toEqual(action); // Preserved for retry!
      expect(state.isModalVisible).toBe(true); // Modal remains visible for retry/dismiss

      // Attempt 2: retry via retryPendingAction after storage issue resolves
      saveOutcome = true;
      await controller.retryPendingAction();

      expect(saveConsent).toHaveBeenCalledTimes(2);
      expect(onExecuteAction).toHaveBeenCalledTimes(1);
      expect(onExecuteAction).toHaveBeenCalledWith(action);

      state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.error).toBeNull();
      expect(state.consentGranted).toBe(true);
      expect(state.isModalVisible).toBe(false);
      expect(state.pendingAction).toBeNull();
    });

    it("save failure sets status: 'error', preserves pendingAction, and keeps isModalVisible: true so user can retry", async () => {
      const saveConsent = vi.fn().mockResolvedValue(false);
      const onExecuteAction = vi.fn();

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
        onExecuteAction,
      });
      await controller.waitForLoad();

      const action: PendingAiAction = {
        kind: "coach_photo",
        photoUri: "file:///lunch.jpg",
      };
      await controller.requestAction(action);
      expect(controller.getState().isModalVisible).toBe(true);

      await controller.confirmConsent();

      const state = controller.getState();
      expect(state.status).toBe("error");
      expect(state.error).toBe("Failed to save AI consent. Please try again.");
      expect(state.pendingAction).toEqual(action);
      expect(state.isModalVisible).toBe(true);
      expect(onExecuteAction).not.toHaveBeenCalled();
    });

    it("forwards birthYear to saveConsent and transitions isSaving during confirmConsent", async () => {
      let resolveSave:
        ((val: boolean | { ok: boolean; error?: string }) => void) | null =
        null;
      const saveConsent = vi.fn().mockImplementation(() => {
        return new Promise<boolean | { ok: boolean; error?: string }>(
          (resolve) => {
            resolveSave = resolve;
          },
        );
      });
      const onExecuteAction = vi.fn();

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
        onExecuteAction,
      });
      await controller.waitForLoad();

      await controller.requestAction({
        kind: "coach_message",
        text: "Plan my week",
      });

      expect(controller.getState().isSaving).toBe(false);

      const confirmPromise = controller.confirmConsent(1998);

      expect(controller.getState().isSaving).toBe(true);
      expect(controller.getState().status).toBe("saving");
      expect(saveConsent).toHaveBeenCalledWith("user-1", true, true, 1998);

      resolveSave!({ ok: true });
      await confirmPromise;

      expect(controller.getState().isSaving).toBe(false);
      expect(controller.getState().status).toBe("ready");
      expect(onExecuteAction).toHaveBeenCalledTimes(1);
    });

    it("surfaces server error message when saveConsent returns an error object", async () => {
      const saveConsent = vi.fn().mockResolvedValue({
        ok: false,
        error:
          "Mizyun AI features require confirmed adult status (18+). Please specify your birth year.",
      });

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
      });
      await controller.waitForLoad();

      await controller.requestAction({
        kind: "coach_message",
        text: "Hello",
      });

      await controller.confirmConsent();

      expect(controller.getState().status).toBe("error");
      expect(controller.getState().error).toBe(
        "Mizyun AI features require confirmed adult status (18+). Please specify your birth year.",
      );
      expect(controller.getState().isSaving).toBe(false);
      expect(controller.getState().isModalVisible).toBe(true);
    });

    it("calling confirmConsent after error retries saving and dispatches pending action on success", async () => {
      let failFirst = true;
      const saveConsent = vi.fn().mockImplementation(async () => {
        if (failFirst) {
          failFirst = false;
          return false;
        }
        return true;
      });
      const onExecuteAction = vi.fn();

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
        onExecuteAction,
      });
      await controller.waitForLoad();

      const action: PendingAiAction = {
        kind: "coach_message",
        text: "Tell me about recovery",
      };
      await controller.requestAction(action);

      // Attempt 1: fails
      await controller.confirmConsent();
      expect(controller.getState().status).toBe("error");
      expect(controller.getState().isModalVisible).toBe(true);
      expect(controller.getState().pendingAction).toEqual(action);

      // Attempt 2: retry directly via confirmConsent
      await controller.confirmConsent();

      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.error).toBeNull();
      expect(state.consentGranted).toBe(true);
      expect(state.isModalVisible).toBe(false);
      expect(state.pendingAction).toBeNull();
      expect(onExecuteAction).toHaveBeenCalledTimes(1);
      expect(onExecuteAction).toHaveBeenCalledWith(action);
    });

    it("calling retryPendingAction after error transitions to saving, retries saving, and dispatches on success", async () => {
      let failFirst = true;
      const saveConsent = vi.fn().mockImplementation(async () => {
        if (failFirst) {
          failFirst = false;
          return false;
        }
        return true;
      });
      const onExecuteAction = vi.fn();

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
        onExecuteAction,
      });
      await controller.waitForLoad();

      const action: PendingAiAction = {
        kind: "meal_refine_draft",
        instruction: "reduce sodium",
      };
      await controller.requestAction(action);

      // Attempt 1: fails
      await controller.confirmConsent();
      expect(controller.getState().status).toBe("error");
      expect(controller.getState().isModalVisible).toBe(true);

      // Attempt 2: retry via retryPendingAction
      await controller.retryPendingAction();

      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.error).toBeNull();
      expect(state.consentGranted).toBe(true);
      expect(state.isModalVisible).toBe(false);
      expect(state.pendingAction).toBeNull();
      expect(onExecuteAction).toHaveBeenCalledTimes(1);
      expect(onExecuteAction).toHaveBeenCalledWith(action);
    });

    it("clears error and hides modal on declineConsent from error state", async () => {
      const saveConsent = vi.fn().mockResolvedValue(false);
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
      });
      await controller.waitForLoad();

      await controller.requestAction({
        kind: "coach_message",
        text: "Question",
      });
      await controller.confirmConsent();
      expect(controller.getState().status).toBe("error");
      expect(controller.getState().isModalVisible).toBe(true);

      controller.declineConsent();
      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.error).toBeNull();
      expect(state.isModalVisible).toBe(false);
      expect(state.pendingAction).toBeNull();
    });

    it("handles save exception safely as error state and keeps modal visible", async () => {
      const saveConsent = vi
        .fn()
        .mockRejectedValue(new Error("SecureStore exception"));

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
      });
      await controller.waitForLoad();

      await controller.requestAction({
        kind: "meal_refine_draft",
        instruction: "make it spicy",
      });

      await controller.confirmConsent();

      expect(controller.getState().status).toBe("error");
      expect(controller.getState().error).toBe(
        "Failed to save AI consent. Please try again.",
      );
      expect(controller.getState().isModalVisible).toBe(true);
      expect(controller.getState().pendingAction).not.toBeNull();
    });

    it("retryPendingAction is inert if not in error state", async () => {
      const saveConsent = vi.fn().mockResolvedValue(true);
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
      });
      await controller.waitForLoad();

      // In ready state, no pending action
      await controller.retryPendingAction();
      expect(saveConsent).not.toHaveBeenCalled();
    });
  });

  describe("6. declineConsent & revokeConsent", () => {
    it("declineConsent clears pending action, sets status to ready, and executes nothing", async () => {
      const onExecuteAction = vi.fn();
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        onExecuteAction,
      });
      await controller.waitForLoad();

      await controller.requestAction({
        kind: "meal_text_draft",
        text: "Pizza slice",
      });

      expect(controller.getState().status).toBe("required");
      expect(controller.getState().pendingAction).not.toBeNull();

      controller.declineConsent();

      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.pendingAction).toBeNull();
      expect(state.isModalVisible).toBe(false);
      expect(onExecuteAction).not.toHaveBeenCalled();
    });

    it("revokeConsent clears stored status and resets state to revoked", async () => {
      const revokeConsent = vi.fn().mockResolvedValue(true);
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: true, confirmedAdult: true }),
        revokeConsent,
      });
      await controller.waitForLoad();

      expect(controller.getState().consentGranted).toBe(true);

      await controller.revokeConsent();

      expect(revokeConsent).toHaveBeenCalledWith("user-1");
      const state = controller.getState();
      expect(state.status).toBe("revoked");
      expect(state.consentGranted).toBe(false);
      expect(state.confirmedAdult).toBe(false);
      expect(state.pendingAction).toBeNull();
    });

    it("subsequent requestAction after revocation requires consent again", async () => {
      const onExecuteAction = vi.fn();
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: true, confirmedAdult: true }),
        revokeConsent: async () => true,
        onExecuteAction,
      });
      await controller.waitForLoad();

      await controller.revokeConsent();
      expect(controller.getState().status).toBe("revoked");

      // Request action now
      await controller.requestAction({
        kind: "coach_message",
        text: "Hello again",
      });

      expect(onExecuteAction).not.toHaveBeenCalled();
      expect(controller.getState().status).toBe("required");
      expect(controller.getState().isModalVisible).toBe(true);
      expect(controller.getState().pendingAction).toEqual({
        kind: "coach_message",
        text: "Hello again",
      });
    });
  });

  describe("7. Account switch & cleanup", () => {
    it("clears old user's pending action and loads new user's consent on account switch", async () => {
      const onExecuteAction = vi.fn();
      const getConsent = vi.fn().mockImplementation(async (uid: string) => {
        if (uid === "user-a") {
          return { granted: false, confirmedAdult: false };
        }
        if (uid === "user-b") {
          return { granted: true, confirmedAdult: true };
        }
        return { granted: false, confirmedAdult: false };
      });

      const controller = createAiConsentController({
        userId: "user-a",
        getConsent,
        onExecuteAction,
      });
      await controller.waitForLoad();

      // User A creates a pending action
      await controller.requestAction({
        kind: "coach_message",
        text: "User A private coaching question",
      });
      expect(controller.getState().pendingAction).not.toBeNull();

      // Account switch to User B
      controller.updateUserId("user-b");

      // Old pending action is wiped immediately
      expect(controller.getState().pendingAction).toBeNull();
      expect(controller.getState().consentGranted).toBe(false);

      await controller.waitForLoad();

      // User B consent is loaded
      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.consentGranted).toBe(true);
      expect(state.confirmedAdult).toBe(true);
      expect(state.pendingAction).toBeNull();

      // User A's action was never executed
      expect(onExecuteAction).not.toHaveBeenCalled();
    });

    it("prevents late-resolving save for User A from leaking into User B", async () => {
      let resolveSaveUserA!: (val: boolean) => void;
      const saveConsent = vi.fn().mockImplementation(async (uid: string) => {
        if (uid === "user-a") {
          return new Promise<boolean>((resolve) => {
            resolveSaveUserA = resolve;
          });
        }
        return true;
      });

      const onExecuteAction = vi.fn();
      const controller = createAiConsentController({
        userId: "user-a",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
        onExecuteAction,
      });
      await controller.waitForLoad();

      await controller.requestAction({
        kind: "coach_message",
        text: "User A question",
      });

      // User A taps confirm (in flight)
      const savePromise = controller.confirmConsent();

      // While in flight, account switches to User B (unconsented)
      controller.updateUserId("user-b");
      await controller.waitForLoad();

      // Now User A's save resolves
      resolveSaveUserA(true);
      await savePromise;

      // User B's state must NOT have consent granted or User A's action dispatched
      expect(onExecuteAction).not.toHaveBeenCalled();
      expect(controller.getState().consentGranted).toBe(false);
      expect(controller.getState().pendingAction).toBeNull();
    });

    it("discards stale completion from A->B->A account switching and does not dispatch an action under the new generation", async () => {
      let resolveSaveUserA1!: (val: boolean) => void;
      const saveConsent = vi.fn().mockImplementation(async (uid: string) => {
        if (uid === "user-a") {
          return new Promise<boolean>((resolve) => {
            resolveSaveUserA1 = resolve;
          });
        }
        return true;
      });

      const onExecuteAction = vi.fn();
      const controller = createAiConsentController({
        userId: "user-a",
        getConsent: async () => ({ granted: false, confirmedAdult: false }),
        saveConsent,
        onExecuteAction,
      });
      await controller.waitForLoad();

      const action1: PendingAiAction = {
        kind: "coach_message",
        text: "User A question 1",
      };
      await controller.requestAction(action1);

      // User A taps confirm (in flight for User A, generation 1)
      const savePromise1 = controller.confirmConsent();

      // Account switch: User A -> User B
      controller.updateUserId("user-b");
      await controller.waitForLoad();
      expect(controller.getState().pendingAction).toBeNull();

      // Account switch: User B -> User A (A->B->A sequence)
      controller.updateUserId("user-a");
      await controller.waitForLoad();

      // User A creates a new pending action under the new generation
      const action2: PendingAiAction = {
        kind: "coach_message",
        text: "User A question 2 (new generation)",
      };
      await controller.requestAction(action2);
      expect(controller.getState().pendingAction).toEqual(action2);

      // Now the earlier save for User A finally resolves
      resolveSaveUserA1(true);
      await savePromise1;

      // Stale completion from earlier generation must NOT dispatch action2:
      expect(onExecuteAction).not.toHaveBeenCalled();
      // action2 remains pending for the current generation
      expect(controller.getState().pendingAction).toEqual(action2);
      expect(controller.getState().status).toBe("required");
    });

    it("resets state when user signs out (userId -> null)", async () => {
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async () => ({ granted: true, confirmedAdult: true }),
      });
      await controller.waitForLoad();

      expect(controller.getState().consentGranted).toBe(true);

      controller.updateUserId(null);

      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.consentGranted).toBe(false);
      expect(state.confirmedAdult).toBe(false);
      expect(state.pendingAction).toBeNull();
    });

    it("destroy cancels operations and ignores late completions", async () => {
      let resolveLoad!: (val: {
        granted: boolean;
        confirmedAdult: boolean;
      }) => void;
      const getConsent = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      );

      const controller = createAiConsentController({
        userId: "user-1",
        getConsent,
      });

      controller.destroy();
      resolveLoad({ granted: true, confirmedAdult: true });

      // State remains default / destroyed, listeners not called
      expect(controller.getState().consentGranted).toBe(false);
    });
  });

  describe("8. React hook integration (useAiConsentController)", () => {
    it("renders state from controller and responds to actions", async () => {
      const onExecuteAction = vi.fn();
      const { result, unmount } = renderHook(
        (props) => useAiConsentController(props),
        {
          userId: "user-hook-1",
          getConsent: async () => ({ granted: true, confirmedAdult: true }),
          onExecuteAction,
        },
      );

      // Wait for load
      await new Promise((r) => setTimeout(r, 10));

      expect(result.current.status).toBe("ready");
      expect(result.current.consentGranted).toBe(true);
      expect(result.current.confirmedAdult).toBe(true);
      expect(result.current.isModalVisible).toBe(false);

      await result.current.requestAction({
        kind: "coach_message",
        text: "Hook test",
      });

      expect(onExecuteAction).toHaveBeenCalledTimes(1);

      unmount();
    });
  });

  describe("9. Consent version currency (CURRENT_AI_CONSENT_VERSION)", () => {
    it("obsolete consent version is treated as unconsented in loadAiConsent", async () => {
      const obsoleteStore = {
        async getItemAsync() {
          return JSON.stringify({
            granted: true,
            confirmedAdult: true,
            consentedAt: "2025-01-01T00:00:00Z",
            consentVersion: "2025-01-01", // obsolete!
          });
        },
        async setItemAsync() {
          return null;
        },
        async deleteItemAsync() {
          return null;
        },
      };

      const result = await loadAiConsent("user-1", obsoleteStore);
      expect(result.granted).toBe(false);
      expect(result.consentVersion).toBe("2025-01-01");
    });

    it("obsolete remote consent version is treated as unconsented", async () => {
      const store = {
        async getItemAsync() {
          return null;
        },
        async setItemAsync() {
          return null;
        },
        async deleteItemAsync() {
          return null;
        },
      };
      const obsoleteApiClient = {
        request: async () => ({
          ok: true as const,
          value: {
            consent: {
              granted: true,
              confirmedAdult: true,
              consentVersion: "2025-01-01", // obsolete!
              consentedAt: "2025-01-01T00:00:00Z",
              revokedAt: null,
            },
          },
        }),
        status: () => ({
          configured: true as const,
          baseUrl: "https://api.test",
        }),
      };

      const result = await loadAiConsent(
        "user-1",
        store,
        obsoleteApiClient as any,
      );
      expect(result.granted).toBe(false);
      expect(result.consentVersion).toBe("2025-01-01");
    });

    it("controller treats obsolete consent version as ungranted and requires consent on action", async () => {
      const obsoleteStore = {
        async getItemAsync() {
          return JSON.stringify({
            granted: true,
            confirmedAdult: true,
            consentedAt: "2025-01-01T00:00:00Z",
            consentVersion: "2025-01-01", // obsolete
          });
        },
        async setItemAsync() {
          return null;
        },
        async deleteItemAsync() {
          return null;
        },
      };

      const onExecuteAction = vi.fn();
      const controller = createAiConsentController({
        userId: "user-1",
        getConsent: async (uid) => {
          const status = await loadAiConsent(uid, obsoleteStore);
          return {
            granted: status.granted,
            confirmedAdult: status.confirmedAdult,
          };
        },
        onExecuteAction,
      });

      await controller.waitForLoad();

      const state = controller.getState();
      expect(state.status).toBe("ready");
      expect(state.consentGranted).toBe(false);

      // Requesting an action must require consent
      const action: PendingAiAction = {
        kind: "coach_message",
        text: "Help me with pushups",
      };
      await controller.requestAction(action);

      expect(onExecuteAction).not.toHaveBeenCalled();
      expect(controller.getState().status).toBe("required");
      expect(controller.getState().isModalVisible).toBe(true);
      expect(controller.getState().pendingAction).toEqual(action);
    });

    it("current consent version (CURRENT_AI_CONSENT_VERSION) is treated as granted", async () => {
      const currentStore = {
        async getItemAsync() {
          return JSON.stringify({
            granted: true,
            confirmedAdult: true,
            consentedAt: "2026-09-08T12:00:00Z",
            consentVersion: CURRENT_AI_CONSENT_VERSION,
          });
        },
        async setItemAsync() {
          return null;
        },
        async deleteItemAsync() {
          return null;
        },
      };

      const result = await loadAiConsent("user-1", currentStore);
      expect(result.granted).toBe(true);
      expect(result.consentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
    });
  });
});
