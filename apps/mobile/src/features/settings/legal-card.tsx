import { ThemedText } from "@/components/themed-text";
import {
  Card,
  Icon,
  ListGroup,
  ListRow,
  Notice,
  SectionHeader,
} from "@/components/ui";
import { apiConfiguration } from "@/composition/api-client";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
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
  const theme = useTheme();
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

  const openExerciseSource = async () => {
    try {
      await openBrowserAsync("https://repdb.co", {
        presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
      });
    } catch {
      // Keep the source credit visible even if the browser is unavailable.
    }
  };

  const highlight = { backgroundColor: theme.primaryLight };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.advisory,
          highlightAnchor === "medical-advisory" && {
            borderColor: theme.primary,
          },
        ]}
      >
        <Notice
          tone="warning"
          title="Health & Medical Advisory"
          message="Mizyun is an informational fitness and nutrition tool and is not a medical device. Always consult a physician or qualified healthcare provider before starting any new diet or training program."
        />
      </View>

      <ListGroup>
        <ListRow
          title="Privacy policy"
          subtitle="How your health and photo data is protected"
          accessibilityLabel="Open Privacy Policy"
          accessibilityHint="Opens in the browser"
          onPress={() => void openUrl("/legal/privacy")}
          style={highlightAnchor === "privacy-policy" ? highlight : undefined}
        />
        <ListRow
          title="Terms of Service"
          subtitle="Service conditions and membership terms"
          accessibilityLabel="Open Terms of Service"
          accessibilityHint="Opens in the browser"
          onPress={() => void openUrl("/legal/terms")}
          style={highlightAnchor === "terms" ? highlight : undefined}
        />
        <ListRow
          title="Support & Inquiries"
          subtitle="Contact us via email or support channels"
          accessibilityLabel="Open Support and Inquiries"
          accessibilityHint="Opens in the browser"
          onPress={() => void openUrl("/legal/support")}
        />
        <ListRow
          title="Account Deletion"
          subtitle="External data erasure request pathway"
          accessibilityLabel="Open Account Deletion Instructions"
          accessibilityHint="Opens in the browser"
          onPress={() => void openUrl("/legal/delete-account")}
          style={
            highlightAnchor === "external-deletion" ? highlight : undefined
          }
        />
      </ListGroup>

      <SectionHeader title="Credits" />
      <Card padded={false}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Exercise data by RepDB (repdb.co)"
          accessibilityHint="Opens the exercise data source website"
          onPress={openExerciseSource}
          style={({ pressed }) => [
            styles.creditRow,
            pressed && { backgroundColor: theme.backgroundSelected },
          ]}
        >
          <ThemedText type="default" themeColor="primary" style={styles.flex}>
            Exercise data by RepDB (repdb.co)
          </ThemedText>
          <Icon name="externalLink" size={15} color="textTertiary" />
        </Pressable>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
  },
  advisory: {
    borderRadius: Radius.md + 2,
    borderWidth: 2,
    borderColor: "transparent",
  },
  creditRow: {
    minHeight: MinTouchTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  flex: { flex: 1 },
});
