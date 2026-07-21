import { loadMobileConfig } from "@mizyun/config";

/**
 * Expo replaces statically-referenced `process.env.EXPO_PUBLIC_*` expressions
 * in the application bundle. Keep that platform-specific read at the mobile
 * composition boundary, then pass the closed snapshot to the shared validator.
 */
export const mobileConfigResult = loadMobileConfig({
  env: {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  },
});
