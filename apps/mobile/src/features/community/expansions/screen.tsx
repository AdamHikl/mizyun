import { invalidateCommunityReads } from "../state/read-cache";
import React, { useCallback } from "react";
import { Text } from "react-native";
import { type Href, useFocusEffect } from "expo-router";
import { communityFeatureStatusSchema } from "@mizyun/contracts";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/hooks/use-theme";
import { useExpansionCommand } from "./use-expansion-command";
import { ExpansionButton } from "./form";
import { CommunityPage, CommunityRow, CommunitySection } from "../ui";
const sections = [
  {
    title: "Your circles",
    destinations: [
      {
        feature: "groups",
        title: "Private groups",
        description: "Posts, members and rules for a small circle",
        path: "/community/groups",
      },
      {
        feature: "challenges",
        title: "Cooperative challenges",
        description: "Choose workout or rest declarations in a private group",
        path: "/community/challenges",
      },
    ],
  },
  {
    title: "Shared with followers",
    destinations: [
      {
        feature: "routines",
        title: "Shared routines",
        description: "Preview a plan and save an independent private copy",
        path: "/community/routines",
      },
      {
        feature: "media",
        title: "Community photos",
        description: "Separate device-selected photos, reviewed before sharing",
        path: "/community/media",
      },
    ],
  },
  {
    title: "Your choices",
    destinations: [
      {
        feature: "comments",
        title: "Discussion and mentions",
        description: "Manage mentions and discussion preferences",
        path: "/community/comments",
      },
      {
        feature: "discovery",
        title: "Handle prefix discovery",
        description: "An optional wider search for consenting members",
        path: "/community/discover",
      },
    ],
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
    <CommunityPage title="Spaces" backHref="/community">
      <Text style={{ color: t.textSecondary }}>
        Small circles, cooperative goals and deliberate sharing. Each feature
        has its own choice.
      </Text>
      {state.error && (
        <Text accessibilityRole="alert" style={{ color: t.text }}>
          {state.error}
        </Text>
      )}
      <ExpansionButton
        label={state.busy ? "Checking availability…" : "Refresh availability"}
        disabled={state.busy}
        onPress={() => {
          invalidateCommunityReads();
          void state.run({});
        }}
      />
      {sections.map((section) => (
        <CommunitySection key={section.title} title={section.title}>
          {section.destinations.map((destination) => {
            const feature = state.data?.find(
              (item) => item.feature === destination.feature,
            );
            return (
              <CommunityRow
                key={destination.feature}
                title={destination.title}
                description={`${destination.description}${feature ? (feature.enabled ? "" : " · Sharing paused") : " · Availability unconfirmed"}`}
                href={destination.path as Href}
              />
            );
          })}
        </CommunitySection>
      ))}
    </CommunityPage>
  );
}
export function CommunityExpansionsScreen() {
  const { session } = useAuth();
  return <Content key={session?.user.id ?? "signed-out"} />;
}
