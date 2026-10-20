import type { VisionDraftProvider } from "@mizyun/agent-runtime";

/**
 * Which provider serves each `VisionDraftProvider` operation. Composition
 * picks these from the per-feature AI routing in `ServerConfig.aiRouting`.
 */
export interface VisionDraftRoutes {
  /** `generateDraft`: every photo draft (meal, label, Coach photo). */
  readonly photo: VisionDraftProvider;
  /** `generateTextDraft` and `refineDraft`. */
  readonly text: VisionDraftProvider;
  /** `generateActivityDraft`. */
  readonly activity: VisionDraftProvider;
  /** `refineStretchPlan` (ADR-0076). */
  readonly stretch: VisionDraftProvider;
}

type RouteName = keyof VisionDraftRoutes;

export interface RoutedVisionDraftStatus {
  readonly ready: boolean;
  readonly provider: string;
  readonly routes: Readonly<Record<RouteName, string>>;
}

/**
 * Compose one `VisionDraftProvider` that sends each operation to its routed
 * provider. When every route uses the same instance, that instance is
 * returned unchanged, so single-vendor setups behave exactly as before.
 *
 * Optional operations stay absent when their routed provider lacks them, so
 * routes keep returning their 503 "not implemented" responses. Candidates
 * keep the serving provider's own provenance.
 */
export const createRoutingVisionDraftProvider = (
  routes: VisionDraftRoutes,
): VisionDraftProvider => {
  const { photo, text, activity, stretch } = routes;
  if (photo === text && photo === activity && photo === stretch) {
    return photo;
  }
  const distinct = [...new Set([photo, text, activity, stretch])];
  const textDraft = text.generateTextDraft;
  const refine = text.refineDraft;
  const activityDraft = activity.generateActivityDraft;
  const stretchPlan = stretch.refineStretchPlan;
  return {
    async status(): Promise<RoutedVisionDraftStatus> {
      const statuses = new Map(
        await Promise.all(
          distinct.map(async (provider) => {
            const status = await provider.status();
            return [provider, status] as const;
          }),
        ),
      );
      const nameOf = (provider: VisionDraftProvider): string =>
        statuses.get(provider)?.provider ?? "unknown";
      const names = [...new Set(distinct.map(nameOf))];
      return {
        // Ready only when every routed provider can serve its operations.
        ready: [...statuses.values()].every((status) => status.ready),
        provider:
          names.length === 1 ? (names[0] ?? "unknown") : names.join("+"),
        routes: {
          photo: nameOf(photo),
          text: nameOf(text),
          activity: nameOf(activity),
          stretch: nameOf(stretch),
        },
      };
    },
    generateDraft: (request) => photo.generateDraft(request),
    ...(textDraft !== undefined
      ? {
          generateTextDraft: (
            request: Parameters<typeof textDraft>[0],
          ): ReturnType<typeof textDraft> => textDraft.call(text, request),
        }
      : {}),
    ...(refine !== undefined
      ? {
          refineDraft: (
            request: Parameters<typeof refine>[0],
          ): ReturnType<typeof refine> => refine.call(text, request),
        }
      : {}),
    ...(activityDraft !== undefined
      ? {
          generateActivityDraft: (
            request: Parameters<typeof activityDraft>[0],
          ): ReturnType<typeof activityDraft> =>
            activityDraft.call(activity, request),
        }
      : {}),
    ...(stretchPlan !== undefined
      ? {
          refineStretchPlan: (
            request: Parameters<typeof stretchPlan>[0],
          ): ReturnType<typeof stretchPlan> =>
            stretchPlan.call(stretch, request),
        }
      : {}),
  };
};
