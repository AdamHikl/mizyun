import type { MealIllustrationResponse } from "@mizyun/contracts";
import type { ApiError, RequestOptions } from "@mizyun/api-client";
import type { Result } from "@mizyun/core";

export interface IllustrationClient {
  getMealIllustrationCapability(
    options?: Partial<RequestOptions>,
  ): Promise<Result<{ available: boolean }, ApiError>>;
  ensureMealIllustration(
    entryId: string,
    options?: Partial<RequestOptions>,
  ): Promise<Result<MealIllustrationResponse, ApiError>>;
}

/** Bounded foreground observation; provider execution and reuse belong to the server. */
export async function loadAutomaticMealIllustration({
  client,
  entryId,
  owner,
  signal,
  isCurrent,
  onReady,
  pause = abortablePause,
}: {
  readonly client: IllustrationClient;
  readonly entryId: string;
  readonly owner: string;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly onReady: (uri: string) => void;
  readonly pause?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const current = () => !signal.aborted && isCurrent();
  const options = { signal, expectedUserId: owner, isCurrent: current };
  try {
    if (!current()) return;
    const capability = await client.getMealIllustrationCapability(options);
    if (!current() || !capability.ok || !capability.value.available) return;
    for (let attempt = 0; attempt < 8 && current(); attempt++) {
      const result = await client.ensureMealIllustration(entryId, options);
      if (!current() || !result.ok) return;
      if (result.value.status === "ready" && result.value.image) {
        const image = result.value.image;
        onReady(`data:${image.mimeType};base64,${image.base64}`);
        return;
      }
      if (result.value.status !== "pending" || attempt === 7) return;
      await pause(Math.min(2_000 * (attempt + 1), 10_000), signal);
    }
  } catch {
    // Decorative failure, cancellation and offline states never interrupt logging.
  }
}

function abortablePause(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}
