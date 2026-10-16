import { useLocalSearchParams } from "expo-router";

import { CommunityShareBoulderingScreen } from "@/features/community";

export default function CommunityShareBoulderingRoute() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  return (
    <CommunityShareBoulderingScreen
      key={String(sessionId ?? "")}
      sessionId={sessionId}
    />
  );
}
