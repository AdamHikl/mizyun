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
      <Stack.Screen
        name="log-meal"
        options={{ title: "Log a meal", presentation: "modal" }}
      />
      <Stack.Screen
        name="log-workout"
        options={{ title: "Log workout", presentation: "modal" }}
      />
      <Stack.Screen
        name="log-weight"
        options={{ title: "Add weight", presentation: "modal" }}
      />
      <Stack.Screen
        name="edit-meal"
        options={{ title: "Edit meal", presentation: "modal" }}
      />
      <Stack.Screen
        name="feedback"
        options={{ title: "Feedback & Reviews", presentation: "modal" }}
      />
      <Stack.Screen name="nutrition" options={{ title: "Logged meals" }} />
    </Stack>
  );
}
