import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { apiConfiguration } from "@/composition/api-client";
import { Spacing } from "@/constants/theme";
import {
  openBrowserAsync,
  WebBrowserPresentationStyle,
} from "expo-web-browser";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

export function LegalCard({
  highlightAnchor,
}: {
  readonly highlightAnchor?: string;
}) {
  const baseUrl = apiConfiguration.configured
    ? apiConfiguration.baseUrl
    : "https://mizyun-api.phiskel.com";

  const openUrl = async (path: string) => {
    try {
      await openBrowserAsync(`${baseUrl}${path}`, {
        presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
      });
    } catch {
      // Graceful fallback if browser cannot be launched
    }
  };

  return (
    <View style={styles.container}>
      <ThemedView
        type="backgroundElement"
        style={[
          styles.disclaimerContainer,
          highlightAnchor === "medical-advisory" && styles.highlightedSection,
        ]}
      >
        <ThemedText style={styles.disclaimerIcon}>⚠️</ThemedText>
        <View style={styles.disclaimerTextBlock}>
          <ThemedText type="smallBold" style={styles.disclaimerTitle}>
            Health & Medical Advisory
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Mizyun is an informational fitness and nutrition tool and is not a
            medical device. Always consult a physician or qualified healthcare
            provider before starting any new diet or training program.
          </ThemedText>
        </View>
      </ThemedView>

      <View style={styles.legalLinksList}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Privacy Policy"
          onPress={() => void openUrl("/legal/privacy")}
          style={({ pressed }) => [
            styles.legalLinkRow,
            pressed && styles.pressed,
            highlightAnchor === "privacy-policy" && styles.highlightedRow,
          ]}
        >
          <ThemedText style={styles.legalLinkIcon}>📄</ThemedText>
          <View style={styles.legalLinkTextBlock}>
            <ThemedText type="smallBold">Privacy Policy</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              How your health and photo data is protected
            </ThemedText>
          </View>
          <ThemedText style={styles.legalLinkArrow}>↗</ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Terms of Service"
          onPress={() => void openUrl("/legal/terms")}
          style={({ pressed }) => [
            styles.legalLinkRow,
            pressed && styles.pressed,
            highlightAnchor === "terms" && styles.highlightedRow,
          ]}
        >
          <ThemedText style={styles.legalLinkIcon}>⚖️</ThemedText>
          <View style={styles.legalLinkTextBlock}>
            <ThemedText type="smallBold">Terms of Service</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Service conditions and beta access terms
            </ThemedText>
          </View>
          <ThemedText style={styles.legalLinkArrow}>↗</ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Support and Inquiries"
          onPress={() => void openUrl("/legal/support")}
          style={({ pressed }) => [
            styles.legalLinkRow,
            pressed && styles.pressed,
          ]}
        >
          <ThemedText style={styles.legalLinkIcon}>💬</ThemedText>
          <View style={styles.legalLinkTextBlock}>
            <ThemedText type="smallBold">Support & Inquiries</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Contact us via email or support channels
            </ThemedText>
          </View>
          <ThemedText style={styles.legalLinkArrow}>↗</ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Account Deletion Instructions"
          onPress={() => void openUrl("/legal/delete-account")}
          style={({ pressed }) => [
            styles.legalLinkRow,
            pressed && styles.pressed,
            highlightAnchor === "external-deletion" && styles.highlightedRow,
          ]}
        >
          <ThemedText style={styles.legalLinkIcon}>🗑️</ThemedText>
          <View style={styles.legalLinkTextBlock}>
            <ThemedText type="smallBold">Account Deletion</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              External data erasure request pathway
            </ThemedText>
          </View>
          <ThemedText style={styles.legalLinkArrow}>↗</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  disclaimerContainer: {
    flexDirection: "row",
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: 14,
  },
  disclaimerIcon: {
    fontSize: 20,
  },
  disclaimerTextBlock: {
    flex: 1,
    gap: 4,
  },
  disclaimerTitle: {
    fontSize: 14,
  },
  legalLinksList: {
    gap: Spacing.two,
  },
  legalLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
  },
  legalLinkIcon: {
    fontSize: 18,
  },
  legalLinkTextBlock: {
    flex: 1,
    gap: 2,
  },
  legalLinkArrow: {
    fontSize: 16,
    opacity: 0.6,
  },
  highlightedSection: {
    borderWidth: 2,
    borderColor: "#10B981",
  },
  highlightedRow: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "#10B981",
  },
  pressed: {
    opacity: 0.7,
  },
});
