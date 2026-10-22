import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/features/auth/auth-context";
import { usePhotoBackupEnabled } from "./photo-backup-preference";
import { syncPhotoBackups } from "./photo-backup-sync";

const MIN_INTERVAL_MS = 10 * 60_000;
const lastRun = new Map<string, number>();
let running: Promise<unknown> | null = null;

/** Resolves once any background backup run has finished its current upload. */
export const waitForPhotoBackupSync = async (): Promise<void> => {
  while (running) await running.catch(() => null);
};

/**
 * Backs up device-only photos when the app becomes active and Back up photos
 * is on (ADR-0079). One run at a time, at most every ten minutes per account.
 */
export function PhotoBackupBridge() {
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const enabled = usePhotoBackupEnabled(owner);
  useEffect(() => {
    if (!owner || !enabled) return;
    let active = true;
    const run = (force = false) => {
      if (!active || running || AppState.currentState !== "active") return;
      const previous = lastRun.get(owner) ?? 0;
      if (!force && Date.now() - previous < MIN_INTERVAL_MS) return;
      lastRun.set(owner, Date.now());
      running = syncPhotoBackups(owner, {
        isCurrent: () => active && AppState.currentState === "active",
      })
        .catch(() => null)
        .finally(() => {
          running = null;
        });
    };
    // Turning backup on starts a run at once.
    run(true);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [owner, enabled]);
  return null;
}
