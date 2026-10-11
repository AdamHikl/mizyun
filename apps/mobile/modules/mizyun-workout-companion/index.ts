import { requireOptionalNativeModule } from "expo";

interface CompanionNativeModule {
  publish(json: string): Promise<boolean>;
  clear(): Promise<void>;
  addListener(
    event: "onMessage",
    listener: (event: { json: string }) => void,
  ): { remove(): void };
}

const nativeModule = requireOptionalNativeModule<CompanionNativeModule>(
  "MizyunWorkoutCompanion",
);

export function isCompanionNativeAvailable(): boolean {
  return nativeModule !== null;
}

/** Transport acceptance only; mutation receipts arrive separately through onMessage. */
export async function publishCompanionMessage(json: string): Promise<boolean> {
  try {
    return (await nativeModule?.publish(json)) === true;
  } catch {
    return false;
  }
}

export async function clearCompanion(): Promise<void> {
  try {
    await nativeModule?.clear();
  } catch {
    // Expiring watch leases also fail closed when transport is unavailable.
  }
}

export function addCompanionMessageListener(listener: (json: string) => void): {
  remove(): void;
} {
  if (nativeModule === null) return { remove() {} };
  try {
    return nativeModule.addListener("onMessage", (event) => {
      if (typeof event.json === "string" && event.json.length <= 16384)
        listener(event.json);
    });
  } catch {
    return { remove() {} };
  }
}
