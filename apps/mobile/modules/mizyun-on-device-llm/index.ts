import { requireOptionalNativeModule } from "expo";

/**
 * Apple Foundation Models on the device. Prompts and answers never
 * leave the phone. Android and older iPhones report "unsupported".
 */
export type OnDeviceLlmAvailability =
  | "available"
  | "device_not_eligible"
  | "apple_intelligence_disabled"
  | "model_not_ready"
  | "unavailable"
  | "unsupported";

export interface OnDeviceField {
  readonly name: string;
  readonly description: string;
}

interface OnDeviceLlmNativeModule {
  readonly showsTimings?: boolean;
  getAvailability(): Promise<OnDeviceLlmAvailability>;
  prewarm(instructions: string): Promise<void>;
  generateFields(
    instructions: string,
    prompt: string,
    fields: readonly OnDeviceField[],
    maximumResponseTokens: number,
    timeoutMs: number,
  ): Promise<Record<string, string>>;
}

const AVAILABILITIES: ReadonlySet<string> = new Set([
  "available",
  "device_not_eligible",
  "apple_intelligence_disabled",
  "model_not_ready",
  "unavailable",
  "unsupported",
]);

const nativeModule =
  requireOptionalNativeModule<OnDeviceLlmNativeModule>("MizyunOnDeviceLlm");

export async function getOnDeviceLlmAvailability(): Promise<OnDeviceLlmAvailability> {
  if (nativeModule === null) return "unsupported";
  const value = await nativeModule.getAvailability();
  return AVAILABILITIES.has(value)
    ? (value as OnDeviceLlmAvailability)
    : "unavailable";
}

/** True only in the Dev app, which shows generation times to the founder. */
export function onDeviceLlmShowsTimings(): boolean {
  return nativeModule?.showsTimings === true;
}

/** Load the model ahead of the first request; a no-op when unavailable. */
export async function prewarmOnDeviceLlm(instructions: string): Promise<void> {
  if (nativeModule === null) return;
  await nativeModule.prewarm(instructions);
}

/**
 * Fill each named string field. Rejects when the model is unavailable or
 * does not answer within `timeoutMs`; the native call is then cancelled.
 */
export async function generateOnDeviceFields(
  instructions: string,
  prompt: string,
  fields: readonly OnDeviceField[],
  maximumResponseTokens: number,
  timeoutMs: number,
): Promise<Record<string, string>> {
  if (nativeModule === null) {
    throw new Error("On-device generation is not supported here.");
  }
  const values = await nativeModule.generateFields(
    instructions,
    prompt,
    fields,
    maximumResponseTokens,
    timeoutMs,
  );
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (typeof value !== "string") {
      throw new Error(`On-device generation omitted ${field.name}.`);
    }
    result[field.name] = value;
  }
  return result;
}
