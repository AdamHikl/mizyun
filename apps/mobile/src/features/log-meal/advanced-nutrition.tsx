import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import {
  advancedNutritionCapabilityResponseSchema,
  dailyFoodSummaryListResponseSchema,
  type DailyFoodSummary,
} from "@mizyun/contracts";

import { ThemedText } from "@/components/themed-text";
import { MinTouchTarget, Spacing } from "@/constants/theme";
import { apiClient } from "@/composition/api-client";
import { FormField, FormTextInput, Icon } from "@/components/ui";

import type { MealFormStrings } from "./meal-form";
import { parseOptionalNutritionNumber } from "./meal-form";

type AdvancedNutritionCapability = ReturnType<
  typeof advancedNutritionCapabilityResponseSchema.parse
>;

export const fetchAdvancedNutritionCapability = async (
  expectedUserId?: string,
): Promise<boolean> => {
  const result = await apiClient.request<AdvancedNutritionCapability>({
    method: "GET",
    path: "/v1/food-entries/capabilities",
    schema: advancedNutritionCapabilityResponseSchema,
    ...(expectedUserId ? { expectedUserId } : {}),
  });
  return result.ok && result.value.advancedNutrition;
};

// A granted capability is reused in memory for the same account/token so
// refocusing Meals does not re-request it. Only `true` is remembered; a denial
// or failure clears it. Writes stay enforced by the API and database trigger
// (ADR-0029), and `refresh()` always performs a fresh read for pre-save gates.
const GRANT_REUSE_MS = 5 * 60_000;
let rememberedGrant: { scope: string; at: number } | null = null;

const capabilityScope = (userId: string, accessToken?: string | null) =>
  JSON.stringify([userId, accessToken ?? null]);

const recentlyGranted = (scope: string) =>
  rememberedGrant?.scope === scope &&
  Date.now() - rememberedGrant.at < GRANT_REUSE_MS;

/** Forgets the remembered grant (used by tests; grants are already scoped to account and token). */
export const forgetAdvancedNutritionCapability = (): void => {
  rememberedGrant = null;
};

export const useAdvancedNutritionCapability = (
  userId: string | null,
  accessToken?: string | null,
) => {
  const scope = userId === null ? null : capabilityScope(userId, accessToken);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [state, setState] = useState<{
    scope: string | null;
    enabled: boolean;
  }>(() => ({
    scope,
    enabled: scope !== null && recentlyGranted(scope),
  }));
  /** Fresh server read; use before a write or after a Pro change. */
  const refresh = useCallback(async (): Promise<boolean> => {
    if (userId === null || scope === null) {
      setState({ scope, enabled: false });
      return false;
    }
    let next = false;
    try {
      next = await fetchAdvancedNutritionCapability(userId);
    } catch {
      next = false;
    }
    // A late answer for an earlier account/token cannot change this one.
    if (currentScope.current !== scope) return false;
    if (next) rememberedGrant = { scope, at: Date.now() };
    else if (rememberedGrant?.scope === scope) rememberedGrant = null;
    setState({ scope, enabled: next });
    return next;
  }, [userId, scope]);
  /** Reuses a recent grant for this account/token, otherwise reads fresh. */
  const revalidate = useCallback(async (): Promise<boolean> => {
    if (scope !== null && recentlyGranted(scope)) {
      setState((current) =>
        current.scope === scope && current.enabled
          ? current
          : { scope, enabled: true },
      );
      return true;
    }
    return refresh();
  }, [scope, refresh]);
  useEffect(() => {
    void revalidate();
  }, [revalidate]);
  return {
    enabled: state.scope === scope && state.enabled,
    refresh,
    revalidate,
  };
};

const fields = [
  ["fibre", "Fibre (g)"],
  ["saturatedFat", "Saturated fat (g)"],
  ["totalSugars", "Total sugars (g)"],
  ["sodium", "Sodium (mg)"],
  ["cholesterol", "Dietary cholesterol (mg)"],
] as const;

export const fetchCurrentWeekSummaries =
  async (): Promise<ReadonlyArray<DailyFoodSummary> | null> => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const localDate = (date: Date) =>
      [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
    const result = await apiClient.request<{ summaries: DailyFoodSummary[] }>({
      method: "GET",
      path: `/v1/food-entries/summary?from=${localDate(monday)}&to=${localDate(now)}&utcOffsetMinutes=${-now.getTimezoneOffset()}&limit=7`,
      schema: dailyFoodSummaryListResponseSchema,
    });
    return result.ok ? result.value.summaries : null;
  };

export function AdvancedNutrientFields({
  form,
  onChange,
  enabled,
  editableWhenFree = [],
  editable = true,
  per100g = false,
}: {
  readonly form: MealFormStrings;
  readonly onChange: (field: keyof MealFormStrings, value: string) => void;
  readonly enabled: boolean;
  readonly editable?: boolean;
  readonly per100g?: boolean;
  readonly editableWhenFree?: ReadonlyArray<keyof MealFormStrings>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saltMode, setSaltMode] = useState(false);
  return (
    <View style={{ gap: Spacing.two, marginVertical: Spacing.three }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More nutrients"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={{
          minHeight: MinTouchTarget,
          flexDirection: "row",
          alignItems: "center",
          gap: Spacing.two,
        }}
      >
        <Icon
          name={expanded ? "chevronDown" : "chevronRight"}
          size={14}
          color="textSecondary"
        />
        <ThemedText type="smallBold">
          More nutrients {enabled ? "" : "· Pro"}
        </ThemedText>
      </Pressable>
      {expanded ? (
        enabled || editableWhenFree.length > 0 ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Label values or AI estimates. AI estimates are uncertain; review
              before saving. Blank means not recorded. Existing values can be
              corrected or cleared.
            </ThemedText>
            {fields
              .filter(([key]) => enabled || editableWhenFree.includes(key))
              .map(([key, label]) => (
                <FormField
                  key={key}
                  label={
                    (key === "sodium" && saltMode ? "Salt (g)" : label) +
                    (per100g ? " per 100 g" : "")
                  }
                >
                  <FormTextInput
                    accessibilityLabel={
                      (key === "sodium" && saltMode ? "Salt in grams" : label) +
                      (per100g ? " per 100 g" : "")
                    }
                    editable={editable}
                    keyboardType="decimal-pad"
                    placeholder="Not recorded"
                    value={
                      key === "sodium" && saltMode && form.sodium
                        ? Number.isFinite(Number(form.sodium.replace(",", ".")))
                          ? String(Number(form.sodium.replace(",", ".")) / 400)
                          : form.sodium
                        : (form[key] ?? "")
                    }
                    onChangeText={(value) => {
                      if (key !== "sodium" || !saltMode) {
                        onChange(key, value);
                        return;
                      }
                      const parsed = parseOptionalNutritionNumber(value);
                      onChange(
                        "sodium",
                        parsed.ok && parsed.value !== null
                          ? String(parsed.value * 400)
                          : value.trim() === ""
                            ? ""
                            : value,
                      );
                    }}
                  />
                  {key === "sodium" ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        saltMode ? "Enter sodium instead" : "Enter salt instead"
                      }
                      onPress={() => setSaltMode((current) => !current)}
                      style={{
                        minHeight: MinTouchTarget,
                        justifyContent: "center",
                      }}
                    >
                      <ThemedText type="small" themeColor="textSecondary">
                        Enter {saltMode ? "sodium (mg)" : "salt (g)"} instead ·
                        1 g salt = 400 mg sodium
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </FormField>
              ))}
          </>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Fibre, saturated fat, sugars, sodium, and cholesterol are
              available with Pro. Existing values remain in your saved meals.
            </ThemedText>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="View Pro access in account settings"
              onPress={() => router.push("/account-settings/ai-usage" as Href)}
              style={{ minHeight: MinTouchTarget, justifyContent: "center" }}
            >
              <ThemedText type="smallBold" themeColor="primary">
                View Pro access
              </ThemedText>
            </Pressable>
          </>
        )
      ) : null}
    </View>
  );
}
