import React from "react";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@/features/auth/auth-context";
import { ActivityDetailScreen } from "@/features/community";

export default function ActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();

  return (
    <ActivityDetailScreen
      activityId={id ?? ""}
      principalKey={session?.user.id ?? null}
    />
  );
}
