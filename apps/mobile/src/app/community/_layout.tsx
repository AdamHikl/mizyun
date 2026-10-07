import { Stack } from "expo-router";

/** Community presentation provides one shared header and explicit parent fallback. */
export default function CommunityLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
