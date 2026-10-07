import { Tabs } from "expo-router";

export default function CommunityTabLayout() {
  return (
    <Tabs
      tabBar={() => null}
      screenOptions={{ headerShown: false, animation: "none" }}
    />
  );
}
