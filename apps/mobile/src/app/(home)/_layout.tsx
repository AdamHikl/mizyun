import { Stack } from "expo-router";

export default function HomeStackLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="body" options={{ title: "Body progress" }} />
      <Stack.Screen name="energy-setup" options={{ title: "Energy inputs" }} />
    </Stack>
  );
}
