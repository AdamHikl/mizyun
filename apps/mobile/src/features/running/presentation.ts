import type { RunRecord } from "@mizyun/contracts";
export const spokenRunPace = (pace: string | null): string =>
  pace
    ? `Average pace, ${pace.replace(":", " minutes ").replace(" /km", " seconds per kilometre").replace(" /mi", " seconds per mile")}`
    : "Average pace unavailable without distance";

const providerNames = {
  apple_health: "Apple Health",
  health_connect: "Health Connect",
} as const;

/** Where a run came from; imported runs keep their provider and source app. */
export const runSourceLabel = (run: RunRecord): string => {
  const origin = run.summary.origin;
  if (origin.kind === "manual") return "Entered manually";
  if (origin.kind === "file_import") return "Imported from Strava export";
  const provider = providerNames[origin.provider];
  return origin.sourceAppName && origin.sourceAppName !== provider
    ? `From ${provider} · ${origin.sourceAppName}`
    : `From ${provider}`;
};

export const runDurationBasisLabel = (run: RunRecord): string =>
  run.summary.durationBasis === "active"
    ? "Moving time, excluding pauses"
    : "Total time including pauses";
