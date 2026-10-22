import type { StretchSessionInput } from "@mizyun/core";

import {
  isoLocalDate,
  type EveningStretchSettings,
} from "./evening-stretch-reminder";
import { shouldTailorStretch } from "./stretch-tailoring";
import type { TodayTraining } from "./today-training-data";

/**
 * Tonight's plan is prepared once at reminder time (default 21:00) so the
 * stretch screen opens on the finished plan. The app cannot run at the
 * exact moment while it is closed, so this runs the first time it is
 * running at or after the reminder: in the foreground at that time, on
 * return to the app, or from the notification tap. The tailored plan is
 * cached per day and training, so later opens do not rebuild it.
 */
export interface TonightStretchPorts {
  variantEnabled(): boolean;
  consent(
    userId: string,
  ): Promise<{ readonly granted: boolean; readonly confirmedAdult: boolean }>;
  /**
   * Cache-first; at most one server call per training state. `allowed` is
   * re-checked before the request and before its answer is cached.
   */
  tailor(
    userId: string,
    input: StretchSessionInput,
    localDate: string,
    allowed: () => Promise<boolean>,
  ): Promise<unknown>;
}

/** Whether an account may see or request an AI-tailored stretch now. */
export const mayTailorStretch = async (
  userId: string,
  ports: Pick<TonightStretchPorts, "variantEnabled" | "consent">,
): Promise<boolean> => {
  const consent = await ports.consent(userId).catch(() => null);
  return (
    consent !== null &&
    shouldTailorStretch({
      variantEnabled: ports.variantEnabled(),
      consentGranted: consent.granted,
      confirmedAdult: consent.confirmedAdult,
      userId,
      trained: true,
    })
  );
};

/** Tonight's reminder instant, or null when no stretch is due today. */
export const tonightReminderAt = (
  settings: EveningStretchSettings,
  now: Date,
): Date | null => {
  if (!settings.enabled || settings.completedDate === isoLocalDate(now)) {
    return null;
  }
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    settings.hour,
    settings.minute,
    0,
    0,
  );
};

export const prepareTonightStretch = async (
  userId: string,
  training: TodayTraining | null,
  now: Date,
  ports: TonightStretchPorts,
  /** False once the account changed; nothing is sent or kept then. */
  isCurrent: () => boolean = () => true,
): Promise<void> => {
  if (training === null || !training.trained) return;
  const allowed = async () =>
    isCurrent() && (await mayTailorStretch(userId, ports));
  if (!(await allowed())) return;
  await ports.tailor(userId, training.input, isoLocalDate(now), allowed);
};
