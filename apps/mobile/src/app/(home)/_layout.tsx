import { Stack } from "expo-router";

export default function HomeStackLayout() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Home" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="body" options={{ title: "Body progress" }} />
      <Stack.Screen name="energy-setup" options={{ title: "Energy inputs" }} />
      <Stack.Screen
        name="progress-photos"
        options={{ title: "Progress photos" }}
      />
    </Stack>
  );
}
