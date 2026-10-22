import { describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { DEFAULT_EVENING_STRETCH } from "./evening-stretch-reminder";
import type { TodayTraining } from "./today-training-data";
import {
  prepareTonightStretch,
  tonightReminderAt,
  type TonightStretchPorts,
} from "./tonight-stretch";

const USER = "00000000-0000-4000-8000-000000000001";
const now = new Date(2026, 9, 22, 21, 5);
const trained: TodayTraining = {
  trained: true,
  input: { exercises: [{ name: "Cable Fly", setCount: 4 }], activities: [] },
};

const ports = (
  over: Partial<TonightStretchPorts> = {},
): TonightStretchPorts & { tailor: ReturnType<typeof vi.fn> } =>
  ({
    variantEnabled: () => true,
    consent: async () => ({ granted: true, confirmedAdult: true }),
    tailor: vi.fn(async () => null),
    ...over,
  }) as never;

describe("tonightReminderAt", () => {
  it("is today at the reminder time, 21:00 by default", () => {
    expect(tonightReminderAt(DEFAULT_EVENING_STRETCH, now)).toEqual(
      new Date(2026, 9, 22, 21, 0),
    );
    expect(
      tonightReminderAt(
        { ...DEFAULT_EVENING_STRETCH, hour: 19, minute: 30 },
        now,
      ),
    ).toEqual(new Date(2026, 9, 22, 19, 30));
  });

  it("is null when the reminder is off or tonight's stretch is done", () => {
    expect(
      tonightReminderAt({ ...DEFAULT_EVENING_STRETCH, enabled: false }, now),
    ).toBeNull();
    expect(
      tonightReminderAt(
        { ...DEFAULT_EVENING_STRETCH, completedDate: "2026-10-22" },
        now,
      ),
    ).toBeNull();
  });
});

describe("prepareTonightStretch", () => {
  it("tailors today's training for an eligible account", async () => {
    const p = ports();
    await prepareTonightStretch(USER, trained, now, p);
    expect(p.tailor).toHaveBeenCalledExactlyOnceWith(
      USER,
      trained.input,
      "2026-10-22",
      expect.any(Function),
    );
  });

  it("lets the load re-check the account and consent before sending and keeping", async () => {
    let current = true;
    let granted = true;
    const p = ports({
      consent: async () => ({ granted, confirmedAdult: true }),
    });
    await prepareTonightStretch(USER, trained, now, p, () => current);
    const allowed = p.tailor.mock.calls[0]![3] as () => Promise<boolean>;

    expect(await allowed()).toBe(true);
    granted = false;
    expect(await allowed()).toBe(false);
    granted = true;
    current = false;
    expect(await allowed()).toBe(false);
  });

  it("sends nothing once the account changed", async () => {
    const p = ports();
    await prepareTonightStretch(USER, trained, now, p, () => false);
    expect(p.tailor).not.toHaveBeenCalled();
  });

  it("makes no AI call without consent, adult eligibility, the build flag or training", async () => {
    const cases: [TodayTraining | null, Partial<TonightStretchPorts>][] = [
      [
        trained,
        { consent: async () => ({ granted: false, confirmedAdult: true }) },
      ],
      [
        trained,
        { consent: async () => ({ granted: true, confirmedAdult: false }) },
      ],
      [trained, { consent: async () => Promise.reject(new Error("read")) }],
      [trained, { variantEnabled: () => false }],
      [{ ...trained, trained: false }, {}],
      [null, {}],
    ];
    for (const [training, over] of cases) {
      const p = ports(over);
      await prepareTonightStretch(USER, training, now, p);
      expect(p.tailor).not.toHaveBeenCalled();
    }
  });
});
