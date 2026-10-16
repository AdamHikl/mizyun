/**
 * Indoor bouldering (ADR-0066) is on in Dev. Other environments need the
 * explicit `MIZYUN_BOULDERING_ENABLED=true` flag.
 */
export const boulderingEnabled = (
  env: Readonly<Record<string, string | undefined>>,
): boolean =>
  env.MIZYUN_ENVIRONMENT === "dev" || env.MIZYUN_BOULDERING_ENABLED === "true";
