import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Vitest configuration for the mobile app. The default behavior would
 * pull `react-native`, `expo-secure-store`, and the Supabase mobile
 * adapter into the test bundle; those modules are not loadable outside
 * Metro. Aliasing them to empty stubs keeps composition-root tests
 * focused on selection logic without taking a runtime dependency on
 * the native runtime.
 *
 * Mirrors the React Native testing recommendations documented at
 * https://docs.expo.dev/guides/testing-unit-tests/ and the broader Expo
 * SDK 57 testing guidance.
 *
 * The workspace alias maps `@mizyun/*` imports to the package source
 * so the test runner can resolve the workspace packages without a
 * build step. The same alias is configured in `apps/mobile/tsconfig.json`
 * for the typechecker.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: [
      // Path alias mirroring the Expo/Metro tsconfig `paths`.
      // Tests resolve `@/...` to the local src directory the same
      // way the app does.
      {
        find: /^@\/(.*)$/,
        replacement: new URL("./src/$1", import.meta.url).pathname,
      },
      {
        find: /^react-native$/,
        replacement: new URL("./vitest/react-native-stub.ts", import.meta.url)
          .pathname,
      },
      {
        find: /^expo-secure-store$/,
        replacement: new URL(
          "./vitest/expo-secure-store-stub.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: /^expo-file-system$/,
        replacement: new URL(
          "./vitest/expo-file-system-stub.ts",
          import.meta.url,
        ).pathname,
      },
      {
        find: /^expo-constants$/,
        replacement: new URL("./vitest/expo-constants-stub.ts", import.meta.url)
          .pathname,
      },
      {
        // Match both `react-native-url-polyfill` and `react-native-url-polyfill/auto`.
        find: /^react-native-url-polyfill(\/.*)?$/,
        replacement: new URL("./vitest/url-polyfill-stub.ts", import.meta.url)
          .pathname,
      },
      // Workspace package alias — `@mizyun/core` resolves to
      // `<repoRoot>/packages/core/src/index.ts`. Each package is
      // listed explicitly so the alias is easy to audit.
      {
        find: /^@mizyun\/config$/,
        replacement: resolve(repoRoot, "packages/config/src/index.ts"),
      },
      {
        find: /^@mizyun\/contracts$/,
        replacement: resolve(repoRoot, "packages/contracts/src/index.ts"),
      },
      {
        find: /^@mizyun\/identity$/,
        replacement: resolve(repoRoot, "packages/identity/src/index.ts"),
      },
      {
        find: /^@mizyun\/core$/,
        replacement: resolve(repoRoot, "packages/core/src/index.ts"),
      },
      {
        find: /^@mizyun\/api-client$/,
        replacement: resolve(repoRoot, "packages/api-client/src/index.ts"),
      },
      {
        find: /^@mizyun\/observability$/,
        replacement: resolve(repoRoot, "packages/observability/src/index.ts"),
      },
    ],
  },
});
