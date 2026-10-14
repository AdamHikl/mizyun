import { ThemedView } from "@/components/themed-view";
import { Button, EmptyState, ListGroup, ListRow } from "@/components/ui";
import { MaxContentWidth, PageGutter, Spacing } from "@/constants/theme";
import {
  getAppVariant,
  isProgressPhotosEnabled,
} from "@/composition/app-variant";
import { useAuth } from "@/features/auth/auth-context";
import { router, Stack } from "expo-router";
import React, { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getSettingsForCategory,
  SETTINGS_CATEGORIES,
  type SettingsAvailabilityContext,
  type SettingsCategoryId,
} from "./settings-catalog";
import { navigateToSetting } from "./settings-destinations";

export function SettingsCategoryScreen({
  categoryId,
}: {
  readonly categoryId: string;
}) {
  const insets = useSafeAreaInsets();
  const { session, profile } = useAuth();

  const categoryDef = useMemo(
    () => SETTINGS_CATEGORIES.find((cat) => cat.id === categoryId),
    [categoryId],
  );

  const availabilityContext: SettingsAvailabilityContext = useMemo(
    () => ({
      isSignedIn: session !== null,
      hasProfile: profile !== null,
      isProgressPhotosEnabled: isProgressPhotosEnabled(),
      isHealthPreviewEnabled: getAppVariant() === "dev",
      isSetupComplete: Boolean(profile?.displayName),
    }),
    [session, profile],
  );

  const items = useMemo(() => {
    if (!categoryDef) return [];
    return getSettingsForCategory(
      categoryDef.id as SettingsCategoryId,
      availabilityContext,
    );
  }, [categoryDef, availabilityContext]);

  if (!categoryDef) {
    return (
      <ThemedView style={styles.page}>
        <Stack.Screen options={{ title: "Settings" }} />
        <View style={styles.centerContainer}>
          <EmptyState
            icon="warning"
            title="Category not found"
            message="This category is not available or has moved."
            action={
              <Button
                label="Go back"
                variant="tinted"
                size="small"
                onPress={() => router.back()}
              />
            }
          />
        </View>
      </ThemedView>
    );
  }

  const bottomPadding = insets.bottom + Spacing.six;

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: categoryDef.title }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomPadding },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ListGroup>
          {items.map((item) => (
            <ListRow
              key={item.id}
              title={item.label}
              subtitle={item.description}
              accessibilityLabel={`${item.label}, ${item.description}`}
              onPress={() => navigateToSetting(item)}
            />
          ))}
        </ListGroup>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    gap: Spacing.four,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
});
