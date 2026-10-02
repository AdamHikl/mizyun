import React, { useCallback } from "react";
import { ScrollView, Text, View } from "react-native";
import { Stack, router, type Href, useFocusEffect } from "expo-router";
import { communityFeatureStatusSchema } from "@mizyun/contracts";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { CommunityIntro } from "../community-presentation";
import { useExpansionCommand } from "./use-expansion-command";
import { ExpansionButton } from "./form";
const destinations = [
  {
    feature: "challenges",
    title: "Shared challenges",
    description:
      "Manage goals and declarations, or join through a private group",
    path: "/community/challenges",
  },
  {
    feature: "groups",
    title: "Private groups",
    description: "A small circle, your rules, deliberate sharing",
    path: "/community/groups",
  },
  {
    feature: "messaging",
    title: "Messages",
    description: "Text conversations after mutual approval and opt-in",
    path: "/community/messages",
  },
  {
    feature: "routines",
    title: "Shared routines",
    description: "Preview a plan, or import your own independent copy",
    path: "/community/routines",
  },
  {
    feature: "comments",
    title: "Conversation and mentions",
    description: "Control who can mention you and find mention updates",
    path: "/community/comments",
  },
  {
    feature: "media",
    title: "Community photos",
    description: "Separate uploads, rights confirmation and safety review",
    path: "/community/media",
  },
  {
    feature: "discovery",
    title: "Discover friends",
    description: "Choose whether others can search a handle prefix",
    path: "/community/discover",
  },
];
function Content() {
  const state = useExpansionCommand(
    "/v1/community/features",
    communityFeatureStatusSchema,
    "GET",
  );
  const t = useTheme();
  useFocusEffect(
    useCallback(() => {
      void state.run({});
    }, [state.run]),
  );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{
        padding: 20,
        gap: 16,
        backgroundColor: t.background,
      }}
    >
      <Stack.Screen options={{ title: "Activities & sharing" }} />
      <CommunityIntro
        icon="🌱"
        title="Connect at your pace"
        description="Every new feature has its own choice. Your workouts, notes and health records stay private until you deliberately share an allowed snapshot. You can always manage your existing choices. Find cooperative challenges inside a private group."
      />
      {state.error && (
        <Text accessibilityRole="alert" style={{ color: t.text }}>
          {state.error}
        </Text>
      )}
      <ExpansionButton
        label={state.busy ? "Checking availability…" : "Refresh availability"}
        disabled={state.busy}
        onPress={() => void state.run({})}
      />
      {destinations.map((d) => {
        const feature = state.data?.find((f) => f.feature === d.feature);
        return (
          <View key={d.feature} style={{ gap: 6 }}>
            <ExpansionButton
              label={`${d.title}${feature && !feature.enabled ? " · sharing paused" : ""}`}
              onPress={() => router.push(d.path as Href)}
            />
            <Text style={{ color: t.textSecondary }}>{d.description}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}
export function CommunityExpansionsScreen() {
  const { session } = useAuth();
  return <Content key={session?.user.id ?? "signed-out"} />;
}
