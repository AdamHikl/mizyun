import type { Profile } from "@mizyun/contracts";

/**
 * REL-01: keeps `profiles.timezone` on the phone's IANA zone so the server's
 * calendar day (Coach "today", meal times) matches Home's.
 *
 * - `profile`: a server profile was resolved (sign-in, refresh, onboarding).
 *   Each user/zone pair is saved at most once per foreground period, so a
 *   stale read arriving after the save or a failing request cannot loop.
 * - `foreground`: the app became active; the zone may have changed (travel)
 *   or an earlier save may have failed, so the pair is tried again.
 *
 * A zone the server rejects (for example an unknown name) is not retried for
 * that user; foreground events fire often (pickers, permission sheets).
 */
export type TimeZoneSyncTrigger = "profile" | "foreground";

export interface ProfileTimeZoneSyncDependencies {
  readonly deviceTimeZone: () => string | null;
  /**
   * PUT /v1/profile `{ timezone }`: the saved profile, `"rejected"` when the
   * server refused the zone (4xx), or null for a failure worth retrying.
   */
  readonly save: (timeZone: string) => Promise<Profile | "rejected" | null>;
}

export interface ProfileTimeZoneSync {
  sync(
    profile: Pick<Profile, "userId" | "timezone"> | null,
    trigger: TimeZoneSyncTrigger,
  ): Promise<Profile | null>;
}

export const readDeviceTimeZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

export const createProfileTimeZoneSync = (
  dependencies: ProfileTimeZoneSyncDependencies,
): ProfileTimeZoneSync => {
  const attempted = new Set<string>();
  const rejected = new Set<string>();
  const inFlight = new Set<string>();
  return {
    async sync(profile, trigger) {
      if (trigger === "foreground") attempted.clear();
      if (profile === null) return null;
      const zone = dependencies.deviceTimeZone();
      if (!zone || zone === profile.timezone) return null;
      const key = `${profile.userId}\n${zone}`;
      if (inFlight.has(key) || attempted.has(key) || rejected.has(key))
        return null;
      attempted.add(key);
      inFlight.add(key);
      try {
        const saved = await dependencies.save(zone);
        if (saved === "rejected") {
          rejected.add(key);
          return null;
        }
        return saved !== null && saved.userId === profile.userId ? saved : null;
      } catch {
        return null;
      } finally {
        inFlight.delete(key);
      }
    },
  };
};
