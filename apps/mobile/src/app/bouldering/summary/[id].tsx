import { useLocalSearchParams } from "expo-router";

import { SessionSummaryScreen } from "@/features/bouldering";

export default function BoulderingSummaryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SessionSummaryScreen key={id} sessionId={id} />;
}
