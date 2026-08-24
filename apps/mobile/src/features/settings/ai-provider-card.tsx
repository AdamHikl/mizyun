import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { apiClient } from "@/composition/api-client";
import { Spacing } from "@/constants/theme";
import {
  profileResponseSchema,
  type AiProvider,
  type Profile,
} from "@mizyun/contracts";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

export interface AiProviderCardProps {
  readonly profile: Profile;
  readonly onSaved: () => Promise<void>;
}

export function AiProviderCard({ profile, onSaved }: AiProviderCardProps) {
  const [selected, setSelected] = useState<AiProvider>(
    profile.aiProvider ?? "mistral",
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSelectProvider = async (provider: AiProvider) => {
    if (provider === selected || saving) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const result = await apiClient.request<{ profile: Profile }>({
        method: "PUT",
        path: "/v1/profile",
        body: { aiProvider: provider },
        schema: profileResponseSchema,
      });

      if (!result.ok) {
        setErrorMessage(
          result.error.kind === "http_error"
            ? result.error.message
            : "Could not switch AI provider.",
        );
        return;
      }

      setSelected(provider);
      await onSaved();
    } catch {
      setErrorMessage("Could not switch AI provider.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="smallBold">AI Model Provider</ThemedText>
        {saving ? <ActivityIndicator size="small" color="#10B981" /> : null}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        Switch the active AI model powering Coach conversations, workout plans,
        and meal photo drafting across the app.
      </ThemedText>

      {errorMessage !== null ? (
        <ThemedText type="small" style={styles.errorText}>
          {errorMessage}
        </ThemedText>
      ) : null}

      <View style={styles.toggleContainer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch to Mistral"
          disabled={saving}
          onPress={() => void onSelectProvider("mistral")}
          style={[
            styles.providerOption,
            selected === "mistral" && styles.providerOptionActive,
          ]}
        >
          <ThemedText
            type="smallBold"
            style={
              selected === "mistral"
                ? styles.providerTextActive
                : styles.providerText
            }
          >
            Mistral
          </ThemedText>
          <ThemedText
            type="small"
            style={
              selected === "mistral" ? styles.subTextActive : styles.subText
            }
          >
            Mistral Medium
          </ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch to Gemini (Google AI Studio)"
          disabled={saving}
          onPress={() => void onSelectProvider("gemini")}
          style={[
            styles.providerOption,
            selected === "gemini" && styles.providerOptionActive,
          ]}
        >
          <ThemedText
            type="smallBold"
            style={
              selected === "gemini"
                ? styles.providerTextActive
                : styles.providerText
            }
          >
            Gemini
          </ThemedText>
          <ThemedText
            type="small"
            style={
              selected === "gemini" ? styles.subTextActive : styles.subText
            }
          >
            Google AI Studio
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  errorText: {
    color: "#EF4444",
  },
  toggleContainer: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  providerOption: {
    flex: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#374151",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: "transparent",
  },
  providerOptionActive: {
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  providerText: {
    color: "#9CA3AF",
  },
  providerTextActive: {
    color: "#10B981",
  },
  subText: {
    color: "#6B7280",
    fontSize: 11,
  },
  subTextActive: {
    color: "#34D399",
    fontSize: 11,
  },
});
