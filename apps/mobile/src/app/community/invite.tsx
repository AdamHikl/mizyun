import React from "react";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@/features/auth/auth-context";
import { DiscoveryScreen } from "@/features/community/discovery/screen";

export default function CommunityInviteScreen() {
  const { session, profile } = useAuth();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = typeof params.token === "string" ? params.token : undefined;
  return (
    <DiscoveryScreen
      key={`${session?.user.id ?? "signed-out"}:${token ?? "discovery"}`}
      token={token}
      principalKey={session?.user.id ?? null}
      birthYear={profile?.birthYear}
    />
  );
}
