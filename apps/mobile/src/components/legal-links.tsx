import {
  openBrowserAsync,
  WebBrowserPresentationStyle,
} from "expo-web-browser";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui";
import { apiConfiguration } from "@/composition/api-client";

export type LegalDocument = "privacy" | "terms";

/** Opens the Privacy Policy or Terms (API redirects to the website copy). */
export const openLegalDocument = async (
  document: LegalDocument,
): Promise<void> => {
  const baseUrl = apiConfiguration.configured
    ? apiConfiguration.baseUrl
    : "https://mizyun-api.phiskel.com";
  try {
    await openBrowserAsync(`${baseUrl}/legal/${document}`, {
      presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
    });
  } catch {
    // The links stay visible if the browser cannot open.
  }
};

/** Privacy Policy and Terms links with an optional lead-in sentence. */
export function LegalLinks({ intro }: { readonly intro?: string }) {
  return (
    <View style={styles.container}>
      {intro ? (
        <ThemedText
          type="footnote"
          themeColor="textSecondary"
          style={styles.center}
        >
          {intro}
        </ThemedText>
      ) : null}
      <View style={styles.row}>
        <Button
          label="Privacy Policy"
          variant="plain"
          accessibilityHint="Opens in the browser"
          onPress={() => void openLegalDocument("privacy")}
        />
        <Button
          label="Terms of Service"
          variant="plain"
          accessibilityHint="Opens in the browser"
          onPress={() => void openLegalDocument("terms")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 2, alignItems: "center" },
  center: { textAlign: "center" },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: 8,
  },
});
