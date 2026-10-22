import { useLocalSearchParams } from "expo-router";
import { isFontGrade } from "@mizyun/core";
import type { BoulderProgressWindowValue } from "@mizyun/contracts";

import { BoulderGradeSendsScreen } from "@/features/bouldering";

const WINDOWS: readonly BoulderProgressWindowValue[] = ["30d", "90d", "all"];
const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function BoulderingGradeRoute() {
  const params = useLocalSearchParams<{ grade?: string; window?: string }>();
  const candidate = (first(params.grade) ?? "").toUpperCase();
  const grade = isFontGrade(candidate) ? candidate : null;
  const window = first(params.window);
  const range = WINDOWS.find((value) => value === window) ?? "90d";
  return (
    <BoulderGradeSendsScreen
      key={`${grade}:${range}`}
      grade={grade}
      window={range}
    />
  );
}
