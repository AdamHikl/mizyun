import { loadMobileConfig } from "@mizyun/config";
import Constants from "expo-constants";
import { applicationId } from "expo-application";
import { Platform } from "react-native";

import { guardMobileEnvironment } from "./mobile-environment";

/**
 * Expo replaces statically-referenced `process.env.EXPO_PUBLIC_*` expressions
 * in the application bundle. Keep that platform-specific read at the mobile
 * composition boundary, then pass the closed snapshot to the shared validator.
 */
const loadedConfig = loadMobileConfig({
  env: {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_AUTH_REDIRECT_URI: process.env.EXPO_PUBLIC_AUTH_REDIRECT_URI,
  },
});

export const mobileConfigResult = guardMobileEnvironment(
  loadedConfig,
  Constants.expoConfig,
  {
    platform: Platform.OS,
    applicationId,
    executionEnvironment: Constants.executionEnvironment,
  },
);
