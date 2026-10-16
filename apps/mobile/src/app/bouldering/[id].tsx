import { useLocalSearchParams } from "expo-router";

import { BoulderingSessionScreen } from "@/features/bouldering";

export default function BoulderingHistoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BoulderingSessionScreen key={id} mode="history" sessionId={id} />;
}
