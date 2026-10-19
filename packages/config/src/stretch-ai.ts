/**
 * AI refinement of the evening stretch session (#298, ADR-0076) is on in
 * Dev. Other environments need the explicit
 * `MIZYUN_STRETCH_AI_ENABLED=true` flag.
 */
export const stretchAiEnabled = (
  env: Readonly<Record<string, string | undefined>>,
): boolean =>
  env.MIZYUN_ENVIRONMENT === "dev" || env.MIZYUN_STRETCH_AI_ENABLED === "true";
