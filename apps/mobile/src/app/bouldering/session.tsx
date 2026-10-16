import { useLocalSearchParams } from "expo-router";

import { BoulderingSessionScreen } from "@/features/bouldering";

export default function BoulderingSessionRoute() {
  const { start } = useLocalSearchParams<{ start?: string }>();
  return <BoulderingSessionScreen mode="active" startOnOpen={start === "1"} />;
}
