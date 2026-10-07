import React from "react";
import { useLocalSearchParams } from "expo-router";
import { CommunityPersonProfileScreen } from "@/features/community/profiles";
export default function CommunityPersonProfileRoute() {
  const { userId } = useLocalSearchParams<{ userId?: string | string[] }>();
  return (
    <CommunityPersonProfileScreen
      userId={typeof userId === "string" ? userId : ""}
    />
  );
}
