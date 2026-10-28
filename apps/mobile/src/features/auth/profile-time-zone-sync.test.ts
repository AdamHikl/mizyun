import { describe, expect, it, vi } from "vitest";
import type { Profile } from "@mizyun/contracts";

import { createProfileTimeZoneSync } from "./profile-time-zone-sync";

const USER = "00000000-0000-4000-8000-000000000001";
const profile = (timezone: string, userId = USER) =>
  ({ userId, timezone }) as Profile;

const harness = (initialZone: string | null = "America/Los_Angeles") => {
  let zone = initialZone;
  const save = vi.fn(
    async (timezone: string): Promise<Profile | "rejected" | null> =>
      profile(timezone),
  );
  const sync = createProfileTimeZoneSync({ deviceTimeZone: () => zone, save });
  return {
    sync,
    save,
    setZone: (next: string | null) => {
      zone = next;
    },
  };
};

describe("profile time zone sync (REL-01)", () => {
  it("saves the device zone when a resolved profile still has the default", async () => {
    const { sync, save } = harness();
    expect(await sync.sync(profile("UTC"), "profile")).toMatchObject({
      timezone: "America/Los_Angeles",
    });
    expect(save).toHaveBeenCalledExactlyOnceWith("America/Los_Angeles");
  });

  it("does nothing when the zones already match, there is no profile or no device zone", async () => {
    const { sync, save, setZone } = harness();
    await sync.sync(profile("America/Los_Angeles"), "profile");
    await sync.sync(null, "profile");
    setZone(null);
    await sync.sync(profile("UTC"), "foreground");
    expect(save).not.toHaveBeenCalled();
  });

  it("saves once per zone for profile reads, so a stale read cannot loop", async () => {
    const { sync, save } = harness();
    await sync.sync(profile("UTC"), "profile");
    // A refresh that started before the save resolves with the old zone.
    expect(await sync.sync(profile("UTC"), "profile")).toBeNull();
    expect(save).toHaveBeenCalledOnce();
  });

  it("does not send a second request while one is in flight", async () => {
    const { sync, save } = harness();
    let release!: (value: Profile) => void;
    save.mockImplementationOnce(
      () => new Promise<Profile>((resolve) => (release = resolve)),
    );
    const first = sync.sync(profile("UTC"), "profile");
    expect(await sync.sync(profile("UTC"), "foreground")).toBeNull();
    release(profile("America/Los_Angeles"));
    await first;
    expect(save).toHaveBeenCalledOnce();
  });

  it("retries a failed save when the app returns to the foreground", async () => {
    const { sync, save } = harness();
    save.mockResolvedValueOnce(null);
    expect(await sync.sync(profile("UTC"), "profile")).toBeNull();
    expect(await sync.sync(profile("UTC"), "profile")).toBeNull();
    expect(await sync.sync(profile("UTC"), "foreground")).toMatchObject({
      timezone: "America/Los_Angeles",
    });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not retry a zone the server rejected, until the zone changes", async () => {
    const { sync, save, setZone } = harness("Etc/Unknown");
    save.mockResolvedValueOnce("rejected");
    await sync.sync(profile("UTC"), "profile");
    expect(await sync.sync(profile("UTC"), "foreground")).toBeNull();
    expect(save).toHaveBeenCalledOnce();
    setZone("America/Los_Angeles");
    expect(await sync.sync(profile("UTC"), "foreground")).toMatchObject({
      timezone: "America/Los_Angeles",
    });
  });

  it("treats a thrown save as a failure", async () => {
    const { sync, save } = harness();
    save.mockRejectedValueOnce(new Error("offline"));
    expect(await sync.sync(profile("UTC"), "profile")).toBeNull();
  });

  it("saves the new zone after travel when the app becomes active", async () => {
    const { sync, save, setZone } = harness();
    await sync.sync(profile("America/Los_Angeles"), "profile");
    setZone("Europe/Paris");
    expect(
      await sync.sync(profile("America/Los_Angeles"), "foreground"),
    ).toMatchObject({ timezone: "Europe/Paris" });
    expect(save).toHaveBeenCalledExactlyOnceWith("Europe/Paris");
  });

  it("ignores a saved profile for another account", async () => {
    const { sync, save } = harness();
    save.mockResolvedValueOnce(profile("America/Los_Angeles", "other-user"));
    expect(await sync.sync(profile("UTC"), "profile")).toBeNull();
  });
});
