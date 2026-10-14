import { useCallback, useRef, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { createRecurringMealSuggestionApi } from "@mizyun/api-client";
import { apiClient } from "@/composition/api-client";
import { ThemedText } from "@/components/themed-text";
import {
  isRecurringSuggestionOwnerActive,
  recurringSuggestionLifetime,
  retireRecurringMealSuggestions,
} from "./recurring-meal-suggestion-lifetime";

/** Server-owned controls survive another device and leave enabled schedules alone. */
export function RecurringMealSuggestionControls({
  userId,
}: {
  userId: string | null;
}) {
  const [value, setValue] = useState<{
    owner: string;
    enabled: boolean;
    revision: number;
  } | null>(null);
  const [pending, setPending] = useState<{
    owner: string;
    revision: number;
  } | null>(null);
  const [failure, setFailure] = useState<{
    owner: string;
    revision: number;
    message: string;
  } | null>(null);
  const revisionNow = userId ? recurringSuggestionLifetime(userId) : 0;
  const busy = pending?.owner === userId && pending.revision === revisionNow;
  const error =
    failure?.owner === userId && failure.revision === revisionNow
      ? failure.message
      : null;
  const owner = useRef(userId);
  owner.current = userId;
  useFocusEffect(
    useCallback(() => {
      if (!userId || !isRecurringSuggestionOwnerActive(userId)) return;
      let mounted = true;
      const revision = recurringSuggestionLifetime(userId);
      const isCurrent = () =>
        mounted &&
        owner.current === userId &&
        isRecurringSuggestionOwnerActive(userId) &&
        revision === recurringSuggestionLifetime(userId);
      void createRecurringMealSuggestionApi(apiClient)
        .preferences({ expectedUserId: userId, isCurrent })
        .then((result) => {
          if (isCurrent() && result.ok)
            setValue({
              owner: userId,
              revision,
              enabled: result.value.enabled,
            });
        });
      return () => {
        mounted = false;
      };
    }, [userId, revisionNow]),
  );
  if (
    !userId ||
    value?.owner !== userId ||
    value.revision !== revisionNow ||
    !isRecurringSuggestionOwnerActive(userId)
  )
    return null;
  const change = async (enabled?: boolean) => {
    if (busy) return;
    const captured = userId;
    const revision = recurringSuggestionLifetime(captured);
    const isCurrent = () =>
      owner.current === captured &&
      isRecurringSuggestionOwnerActive(captured) &&
      revision === recurringSuggestionLifetime(captured);
    setPending({ owner: captured, revision });
    setFailure(null);
    const api = createRecurringMealSuggestionApi(apiClient);
    const lifetime = { expectedUserId: captured, isCurrent };
    try {
      const result =
        enabled === undefined
          ? await api.reset(lifetime)
          : await api.setPreferences({ enabled }, lifetime);
      if (!isCurrent()) return;
      if (!result.ok) {
        setFailure({
          owner: captured,
          revision,
          message: "Could not save suggestions settings. Try again.",
        });
        return;
      }
      if (enabled !== undefined)
        setValue({ owner: captured, revision, enabled });
      retireRecurringMealSuggestions(captured);
    } catch {
      if (isCurrent())
        setFailure({
          owner: captured,
          revision,
          message: "Could not save suggestions settings. Try again.",
        });
    } finally {
      setPending((current) =>
        current?.owner === captured && current.revision === revision
          ? null
          : current,
      );
    }
  };
  return (
    <View style={{ gap: 8, marginVertical: 12 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <ThemedText style={{ flex: 1 }}>Suggest recurring meals</ThemedText>
        <Switch
          accessibilityLabel="Suggest recurring meals"
          accessibilityHint="Offers automatic logging when you repeatedly log the same meal. Existing schedules keep running."
          value={value.enabled}
          disabled={busy}
          onValueChange={(enabled) => void change(enabled)}
        />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Turning suggestions off leaves your existing schedules unchanged.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void change()}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <ThemedText>Allow dismissed suggestions again</ThemedText>
      </Pressable>
      {error ? (
        <ThemedText accessibilityRole="alert">{error}</ThemedText>
      ) : null}
    </View>
  );
}
