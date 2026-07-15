/**
 * `process.env` is mutable. The loader takes a frozen snapshot so tests are
 * deterministic and a later mutation in the application lifecycle cannot
 * change a value that has already been validated.
 */
export type EnvSnapshot = Readonly<Record<string, string | undefined>>;

const snapshotFrom = (
  source: Readonly<Record<string, string | undefined>>,
): EnvSnapshot => Object.freeze({ ...source });

/**
 * Default environment source used by both loaders when no explicit `env`
 * argument is provided. Returns a shallow clone so subsequent `process.env`
 * mutations do not affect the snapshot.
 */
export const readProcessEnv = (): EnvSnapshot => snapshotFrom(process.env);

/**
 * Test-friendly constructor that mirrors `readProcessEnv` but accepts an
 * explicit object. Exported primarily so loader unit tests do not need to
 * mutate `process.env` directly.
 */
export const envSnapshotFrom = (
  source: Readonly<Record<string, string | undefined>>,
): EnvSnapshot => snapshotFrom(source);

/**
 * Lower-case helper for the closed-world allowlist. The mobile loader must
 * treat the public prefix as case-sensitive (Metro does the same), so this is
 * a straight `===` comparison rather than a normalized comparison.
 */
export const PUBLIC_ENV_PREFIX = "EXPO_PUBLIC_";

export const isPublicEnvKey = (key: string): boolean =>
  key.startsWith(PUBLIC_ENV_PREFIX);
