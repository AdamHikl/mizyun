import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { FeedbackCategory, FeedbackItem } from "@mizyun/contracts";
import * as ImagePicker from "expo-image-picker";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  loadUserFeedback,
  submitFeedback,
  uploadFeedbackAttachment,
  type PreparedFeedbackAttachment,
} from "./feedback-data";

interface CategoryOption {
  readonly key: FeedbackCategory;
  readonly label: string;
  readonly placeholder: string;
}

const CATEGORIES: readonly CategoryOption[] = [
  {
    key: "like",
    label: "✨ What you like",
    placeholder: "What features or details are working really well for you?",
  },
  {
    key: "dislike",
    label: "⚡ What you don't like",
    placeholder: "What feels annoying, confusing, or could be smoother?",
  },
  {
    key: "change",
    label: "💡 Idea / Change",
    placeholder: "What would you change, add, or improve next?",
  },
  {
    key: "bug",
    label: "🐛 Bug / Issue",
    placeholder: "What went wrong, and what steps reproduced it?",
  },
  {
    key: "general",
    label: "💬 General review",
    placeholder: "Share any thoughts or overall review of your experience...",
  },
];

export function FeedbackScreen() {
  const theme = useTheme();
  const [category, setCategory] = useState<FeedbackCategory>("like");
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<
    readonly PreparedFeedbackAttachment[]
  >([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pastFeedback, setPastFeedback] = useState<readonly FeedbackItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const activeCategory =
    CATEGORIES.find((c) => c.key === category) ?? CATEGORIES[0]!;

  const refreshHistory = useCallback(async () => {
    setLoadingHistory(true);
    const result = await loadUserFeedback();
    setLoadingHistory(false);
    if (result.ok) {
      setPastFeedback(result.feedback);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const onSelectRating = (star: number) => {
    setRating((prev) => (prev === star ? null : star));
  };

  const onPickImages = async () => {
    if (attachments.length >= 3) {
      setError("You can attach up to 3 screenshots or photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 3 - attachments.length,
      quality: 0.8,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const newItems: PreparedFeedbackAttachment[] = result.assets.map(
        (asset) => ({
          uri: asset.uri,
          mimeType: asset.mimeType ?? "image/jpeg",
          byteSize: asset.fileSize ?? 1024 * 100,
          width: asset.width ?? 800,
          height: asset.height ?? 600,
        }),
      );
      setAttachments((prev) => [...prev, ...newItems].slice(0, 3));
      setError(null);
    }
  };

  const onRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmit = useCallback(async () => {
    if (message.trim().length === 0) {
      setError("Please enter your feedback message before sending.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const mediaAssetIds: string[] = [];
    if (attachments.length > 0) {
      setUploadingPhotos(true);
      for (const attachment of attachments) {
        const uploadResult = await uploadFeedbackAttachment(attachment);
        if (!uploadResult.ok) {
          setUploadingPhotos(false);
          setSubmitting(false);
          setError(uploadResult.message);
          return;
        }
        mediaAssetIds.push(uploadResult.assetId);
      }
      setUploadingPhotos(false);
    }

    const result = await submitFeedback({
      category,
      rating,
      message: message.trim(),
      mediaAssetIds,
    });

    setSubmitting(false);

    if (result.ok) {
      setSubmitted(true);
      setMessage("");
      setRating(null);
      setAttachments([]);
      void refreshHistory();
    } else {
      setError(result.message);
    }
  }, [attachments, category, message, rating, refreshHistory]);

  const onReset = () => {
    setSubmitted(false);
    setError(null);
    setMessage("");
    setRating(null);
    setAttachments([]);
  };

  return (
    <ThemedView style={styles.page}>
      <Stack.Screen options={{ title: "Feedback & Reviews" }} />
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <ThemedText type="subtitle">Help improve Mizyun</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Your feedback goes directly to the founder. Let us know what you
              love, what feels clunky, or what features you would change.
            </ThemedText>
          </View>

          {submitted ? (
            <ThemedView type="backgroundElement" style={styles.successCard}>
              <ThemedText type="subtitle" style={styles.successTitle}>
                Thank you! 🙌
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Your feedback and screenshots have been recorded and will help
                shape upcoming updates and improvements.
              </ThemedText>
              <View style={styles.successActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={onReset}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <ThemedText type="smallBold" style={styles.primaryButtonText}>
                    Send more feedback
                  </ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.back()}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <ThemedText type="smallBold">Done</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          ) : (
            <ThemedView type="backgroundElement" style={styles.formCard}>
              <ThemedText type="smallBold">Category</ThemedText>
              <View style={styles.categoryChips}>
                {CATEGORIES.map((cat) => {
                  const selected = category === cat.key;
                  return (
                    <Pressable
                      key={cat.key}
                      accessibilityRole="button"
                      accessibilityLabel={cat.label}
                      onPress={() => {
                        setCategory(cat.key);
                        setError(null);
                      }}
                      style={({ pressed }) => [
                        styles.chip,
                        selected && styles.chipSelected,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <ThemedText
                        type="small"
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}
                      >
                        {cat.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.ratingSection}>
                <ThemedText type="smallBold">Rating (optional)</ThemedText>
                <View style={styles.starRow}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const filled = rating !== null && rating >= star;
                    return (
                      <Pressable
                        key={star}
                        accessibilityRole="button"
                        accessibilityLabel={`${star} stars`}
                        onPress={() => onSelectRating(star)}
                        style={({ pressed }) => [
                          styles.starButton,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <ThemedText style={styles.starIcon}>
                          {filled ? "★" : "☆"}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                  {rating !== null ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear rating"
                      onPress={() => setRating(null)}
                      style={styles.clearRatingButton}
                    >
                      <ThemedText type="small" themeColor="textSecondary">
                        Clear
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              <View style={styles.messageSection}>
                <ThemedText type="smallBold">Your message</ThemedText>
                <TextInput
                  accessibilityLabel="Feedback message"
                  multiline
                  numberOfLines={4}
                  maxLength={4000}
                  placeholder={activeCategory.placeholder}
                  placeholderTextColor="#8A8D91"
                  value={message}
                  onChangeText={(text) => {
                    setMessage(text);
                    if (error) setError(null);
                  }}
                  style={[
                    styles.textInput,
                    { color: theme.text, borderColor: theme.border },
                  ]}
                  textAlignVertical="top"
                />
                <View style={styles.charCountRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {message.length} / 4000
                  </ThemedText>
                </View>
              </View>

              <View style={styles.attachmentSection}>
                <ThemedText type="smallBold">
                  Screenshots / Photos (optional, max 3)
                </ThemedText>
                {attachments.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.thumbnailRow}
                  >
                    {attachments.map((att, idx) => (
                      <View key={att.uri} style={styles.thumbnailContainer}>
                        <Image
                          source={{ uri: att.uri }}
                          style={styles.thumbnail}
                          resizeMode="cover"
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Remove photo"
                          onPress={() => onRemoveAttachment(idx)}
                          style={styles.removeThumbnailBadge}
                        >
                          <ThemedText style={styles.removeThumbnailText}>
                            ✕
                          </ThemedText>
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                ) : null}

                {attachments.length < 3 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Attach photo or screenshot"
                    onPress={() => void onPickImages()}
                    style={({ pressed }) => [
                      styles.attachButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <ThemedText
                      type="smallBold"
                      style={styles.attachButtonText}
                    >
                      📷{" "}
                      {attachments.length === 0
                        ? "Attach screenshot or photo"
                        : `Add another (${attachments.length}/3)`}
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>

              {error !== null ? (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.errorText}
                  accessibilityRole="alert"
                >
                  {error}
                </ThemedText>
              ) : null}

              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                accessibilityState={{ disabled: submitting, busy: submitting }}
                onPress={() => void onSubmit()}
                style={({ pressed }) => [
                  styles.submitButton,
                  (pressed || submitting) && styles.buttonPressed,
                  submitting && styles.buttonDisabled,
                ]}
              >
                {submitting ? (
                  <View style={styles.submittingRow}>
                    <ActivityIndicator color="#000000" size="small" />
                    <ThemedText
                      type="smallBold"
                      style={styles.primaryButtonText}
                    >
                      {uploadingPhotos
                        ? "Uploading screenshots..."
                        : "Submitting..."}
                    </ThemedText>
                  </View>
                ) : (
                  <ThemedText type="smallBold" style={styles.primaryButtonText}>
                    Submit feedback
                  </ThemedText>
                )}
              </Pressable>
            </ThemedView>
          )}

          {pastFeedback.length > 0 ? (
            <ThemedView type="backgroundElement" style={styles.historyCard}>
              <ThemedText type="smallBold">Your previous feedback</ThemedText>
              {loadingHistory ? (
                <ActivityIndicator style={{ paddingVertical: Spacing.two }} />
              ) : (
                <View style={styles.historyList}>
                  {pastFeedback.map((item) => (
                    <View key={item.id} style={styles.historyItem}>
                      <View style={styles.historyHeader}>
                        <ThemedText type="smallBold">
                          {formatCategoryLabel(item.category)}
                        </ThemedText>
                        {item.rating !== null ? (
                          <ThemedText type="small" style={styles.ratingBadge}>
                            {"★".repeat(item.rating)}
                          </ThemedText>
                        ) : null}
                        {item.mediaAssetIds && item.mediaAssetIds.length > 0 ? (
                          <ThemedText
                            type="small"
                            themeColor="textSecondary"
                            style={styles.photoCountBadge}
                          >
                            📎 {item.mediaAssetIds.length} photo
                            {item.mediaAssetIds.length > 1 ? "s" : ""}
                          </ThemedText>
                        ) : null}
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          style={styles.historyDate}
                        >
                          {new Date(item.createdAt).toLocaleDateString()}
                        </ThemedText>
                      </View>
                      <ThemedText type="small" themeColor="textSecondary">
                        {item.message}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              )}
            </ThemedView>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function formatCategoryLabel(category: FeedbackCategory): string {
  switch (category) {
    case "like":
      return "✨ Like";
    case "dislike":
      return "⚡ Dislike";
    case "change":
      return "💡 Idea / Change";
    case "bug":
      return "🐛 Bug";
    case "general":
      return "💬 Review";
  }
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  header: { gap: Spacing.one },
  formCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.15)",
  },
  successCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "#10B981",
    alignItems: "center",
    backgroundColor: "rgba(16, 185, 129, 0.05)",
  },
  successTitle: {
    color: "#10B981",
  },
  successActions: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.two,
    width: "100%",
  },
  categoryChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  chip: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
    backgroundColor: "transparent",
  },
  chipSelected: {
    borderColor: "#10B981",
    backgroundColor: "rgba(16, 185, 129, 0.12)",
  },
  chipText: {
    fontSize: 13,
  },
  chipTextSelected: {
    fontWeight: "700",
    color: "#10B981",
  },
  ratingSection: {
    gap: Spacing.one,
  },
  starRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  starButton: {
    padding: Spacing.one,
  },
  starIcon: {
    fontSize: 26,
    color: "#F59E0B",
  },
  clearRatingButton: {
    marginLeft: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  messageSection: {
    gap: Spacing.one,
  },
  textInput: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    fontSize: 15,
  },
  charCountRow: {
    alignItems: "flex-end",
  },
  attachmentSection: {
    gap: Spacing.two,
  },
  thumbnailRow: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  thumbnailContainer: {
    position: "relative",
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
  },
  thumbnail: {
    width: "100%",
    height: "100%",
  },
  removeThumbnailBadge: {
    position: "absolute",
    top: 3,
    right: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeThumbnailText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 13,
  },
  attachButton: {
    borderRadius: 12,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
    backgroundColor: "rgba(16, 185, 129, 0.08)",
  },
  attachButtonText: {
    color: "#10B981",
  },
  errorText: {
    color: "#EF4444",
  },
  submitButton: {
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: "center",
    backgroundColor: "#10B981",
    marginTop: Spacing.one,
  },
  submittingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  primaryButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: "center",
    backgroundColor: "#10B981",
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
  },
  primaryButtonText: {
    color: "#000000",
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  historyCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  historyList: {
    gap: Spacing.three,
  },
  historyItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(148, 163, 184, 0.2)",
    paddingBottom: Spacing.two,
    gap: Spacing.half,
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  ratingBadge: {
    color: "#F59E0B",
    fontSize: 13,
  },
  photoCountBadge: {
    fontSize: 12,
  },
  historyDate: {
    marginLeft: "auto",
    fontSize: 12,
  },
});
