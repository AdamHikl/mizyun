import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the mobile app. The default behavior would
 * pull `react-native`, `expo-secure-store`, and the Supabase mobile
 * adapter into the test bundle; those modules are not loadable outside
 * Metro. Aliasing them to empty stubs keeps composition-root tests
 * focused on selection logic without taking a runtime dependency on the
 * native runtime.
 *
 * Mirrors the React Native testing recommendations documented at
 * https://docs.expo.dev/guides/testing-unit-tests/ and the broader Expo
 * SDK 57 testing guidance.
 */
export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: [
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
        // Match both `react-native-url-polyfill` and `react-native-url-polyfill/auto`.
        find: /^react-native-url-polyfill(\/.*)?$/,
        replacement: new URL("./vitest/url-polyfill-stub.ts", import.meta.url)
          .pathname,
      },
    ],
  },
});
