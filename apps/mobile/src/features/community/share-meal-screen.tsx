import React, { useCallback, useState } from "react";
import { Text } from "react-native";
import { useFocusEffect, type Href } from "expo-router";
import {
  foodEntryListResponseSchema,
  type FoodEntryListResponse,
} from "@mizyun/contracts";
import { useTheme } from "@/hooks/use-theme";
import { useExpansionCommand } from "./expansions/use-expansion-command";
import { ShareMealModal } from "./share-meal-modal";
import {
  CommunityButton,
  CommunityPage,
  CommunityRow,
  CommunityState,
} from "./ui";

import type { FoodEntry } from "@mizyun/contracts";

/** Private saved meals are selectable only by their confirmed owner. */
export function selectableSharedMeals(
  meals: readonly FoodEntry[],
  owner: string,
): FoodEntry[] {
  return meals.filter((meal) => meal.userId === owner && meal.confirmedByUser);
}

export function CommunityShareMealScreen() {
  const colors = useTheme();
  const { principal, data, run, busy, error, capture } =
    useExpansionCommand<FoodEntryListResponse>(
      "/v1/food-entries?limit=200",
      foodEntryListResponseSchema,
      "GET",
    );
  const [selection, setSelection] = useState<{
    id: string;
    current: () => boolean;
  } | null>(null);
  useFocusEffect(
    useCallback(() => {
      void run({});
      return () => setSelection(null);
    }, [run]),
  );
  const meals =
    data && principal ? selectableSharedMeals(data.foodEntries, principal) : [];
  const selected = selection?.current() && data ? selection.id : null;
  return (
    <CommunityPage
      title="Share meal"
      description="Choose a saved confirmed meal. You will preview exactly what your approved followers can see."
    >
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          {error}
        </Text>
      ) : null}
      {busy ? (
        <CommunityState title="Checking saved meals" busy />
      ) : !data ? (
        <CommunityState
          title="Check your saved meals"
          action={
            <CommunityButton
              label="Refresh meals"
              onPress={() => void run({})}
            />
          }
        />
      ) : meals.length === 0 ? (
        <CommunityState
          title="No confirmed meals here"
          description="Save and confirm a meal first. Saving stays private until you deliberately publish a preview."
          action={
            <CommunityButton label="Open meals" href={"/log-meal" as Href} />
          }
        />
      ) : (
        <>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 15,
              lineHeight: 22,
            }}
          >
            Recent confirmed meals from your latest 200 saved entries. The next
            preview shows the meal name and lets you choose whether to include
            nutrition.
          </Text>
          {meals.map((meal) => (
            <CommunityRow
              key={meal.id}
              title={meal.name ?? "Saved meal"}
              description={new Date(meal.consumedAt).toLocaleDateString()}
              onPress={() => setSelection({ id: meal.id, current: capture() })}
            />
          ))}
          <CommunityButton label="Refresh meals" onPress={() => void run({})} />
        </>
      )}
      {selected ? (
        <ShareMealModal
          key={`${principal}:${selected}`}
          visible
          mealId={selected}
          onDismiss={() => setSelection(null)}
          onPublished={() => {
            setSelection(null);
            void run({});
          }}
          onRevoked={() => {
            setSelection(null);
            void run({});
          }}
        />
      ) : null}
    </CommunityPage>
  );
}
