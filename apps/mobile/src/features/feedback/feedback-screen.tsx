import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  Button,
  Card,
  ChoiceChip,
  ChoiceGroup,
  FormField,
  FormStatus,
  FormTextInput,
  Icon,
  IconButton,
  SectionHeader,
} from "@/components/ui";
import {
  BottomTabInset,
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
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
    label: "What you like",
    placeholder: "What features or details are working really well for you?",
  },
  {
    key: "dislike",
    label: "What you don't like",
    placeholder: "What feels annoying, confusing, or could be smoother?",
  },
  {
    key: "change",
    label: "Idea / Change",
    placeholder: "What would you change, add, or improve next?",
  },
  {
    key: "bug",
    label: "Bug / Issue",
    placeholder: "What went wrong, and what steps reproduced it?",
  },
  {
    key: "general",
    label: "General review",
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
            <ThemedText type="title3">Help improve Mizyun</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Your feedback goes directly to the founder. Let us know what you
              love, what feels clunky, or what features you would change.
            </ThemedText>
          </View>

          {submitted ? (
            <Card style={styles.successCard}>
              <Icon name="checkCircle" size={36} color="primary" />
              <ThemedText type="title3">Thank you!</ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={styles.centered}
              >
                Your feedback and screenshots have been recorded and will help
                shape upcoming updates and improvements.
              </ThemedText>
              <View style={styles.successActions}>
                <Button label="Send more feedback" onPress={onReset} block />
                <Button
                  variant="plain"
                  label="Done"
                  onPress={() => router.back()}
                  block
                />
              </View>
            </Card>
          ) : (
            <Card style={styles.formCard}>
              <FormField label="Category">
                <ChoiceGroup>
                  {CATEGORIES.map((cat) => (
                    <ChoiceChip
                      key={cat.key}
                      label={cat.label}
                      selected={category === cat.key}
                      onPress={() => {
                        setCategory(cat.key);
                        setError(null);
                      }}
                    />
                  ))}
                </ChoiceGroup>
              </FormField>

              <FormField label="Rating (optional)">
                <View style={styles.starRow}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const filled = rating !== null && rating >= star;
                    return (
                      <Pressable
                        key={star}
                        accessibilityRole="button"
                        accessibilityLabel={`${star} stars`}
                        accessibilityState={{ selected: filled }}
                        onPress={() => onSelectRating(star)}
                        style={({ pressed }) => [
                          styles.star,
                          pressed && styles.starPressed,
                        ]}
                      >
                        <Icon
                          name={filled ? "starFill" : "star"}
                          size={26}
                          color={filled ? "warning" : "textTertiary"}
                        />
                      </Pressable>
                    );
                  })}
                  {rating !== null ? (
                    <Button
                      variant="plain"
                      size="small"
                      label="Clear"
                      accessibilityLabel="Clear rating"
                      onPress={() => setRating(null)}
                    />
                  ) : null}
                </View>
              </FormField>

              <FormField label="Your message">
                <FormTextInput
                  accessibilityLabel="Feedback message"
                  multiline
                  numberOfLines={4}
                  maxLength={4000}
                  placeholder={activeCategory.placeholder}
                  value={message}
                  onChangeText={(text) => {
                    setMessage(text);
                    if (error) setError(null);
                  }}
                  style={styles.textInput}
                  textAlignVertical="top"
                />
                <ThemedText
                  type="footnote"
                  themeColor="textSecondary"
                  style={styles.charCount}
                >
                  {message.length} / 4000
                </ThemedText>
              </FormField>

              <FormField label="Screenshots / Photos (optional, max 3)">
                <View style={styles.attachmentSection}>
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
                          <View style={styles.removeThumbnail}>
                            <IconButton
                              icon="close"
                              accessibilityLabel="Remove photo"
                              onPress={() => onRemoveAttachment(idx)}
                            />
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}

                  {attachments.length < 3 ? (
                    <Button
                      variant="tinted"
                      icon="camera"
                      accessibilityLabel="Attach photo or screenshot"
                      label={
                        attachments.length === 0
                          ? "Attach screenshot or photo"
                          : `Add another (${attachments.length}/3)`
                      }
                      onPress={() => void onPickImages()}
                    />
                  ) : null}
                </View>
              </FormField>

              {error !== null ? (
                <FormStatus tone="error">{error}</FormStatus>
              ) : null}

              <Button
                label={
                  submitting
                    ? uploadingPhotos
                      ? "Uploading screenshots..."
                      : "Submitting..."
                    : "Submit feedback"
                }
                loading={submitting}
                disabled={submitting}
                onPress={() => void onSubmit()}
              />
            </Card>
          )}

          {pastFeedback.length > 0 ? (
            <View style={styles.history}>
              <SectionHeader title="Your previous feedback" />
              {loadingHistory ? (
                <ActivityIndicator style={{ paddingVertical: Spacing.two }} />
              ) : (
                <Card style={styles.historyList}>
                  {pastFeedback.map((item, index) => (
                    <View
                      key={item.id}
                      style={[
                        styles.historyItem,
                        index > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: theme.separator,
                        },
                      ]}
                    >
                      <View style={styles.historyHeader}>
                        <ThemedText type="smallBold">
                          {formatCategoryLabel(item.category)}
                        </ThemedText>
                        {item.rating !== null ? (
                          <ThemedText type="footnote" themeColor="warning">
                            {item.rating} / 5
                          </ThemedText>
                        ) : null}
                        {item.mediaAssetIds && item.mediaAssetIds.length > 0 ? (
                          <ThemedText
                            type="footnote"
                            themeColor="textSecondary"
                          >
                            {item.mediaAssetIds.length} photo
                            {item.mediaAssetIds.length > 1 ? "s" : ""}
                          </ThemedText>
                        ) : null}
                        <ThemedText
                          type="footnote"
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
                </Card>
              )}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function formatCategoryLabel(category: FeedbackCategory): string {
  switch (category) {
    case "like":
      return "Like";
    case "dislike":
      return "Dislike";
    case "change":
      return "Idea / Change";
    case "bug":
      return "Bug";
    case "general":
      return "Review";
  }
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.six,
    gap: Spacing.four,
  },
  header: { gap: Spacing.one },
  formCard: { gap: Spacing.three },
  successCard: { alignItems: "center", gap: Spacing.two },
  centered: { textAlign: "center" },
  successActions: { gap: Spacing.one, marginTop: Spacing.two, width: "100%" },
  starRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.one,
  },
  star: {
    minWidth: MinTouchTarget,
    minHeight: MinTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  starPressed: { opacity: 0.6 },
  textInput: { minHeight: 120, paddingTop: Spacing.two },
  charCount: { textAlign: "right" },
  attachmentSection: { gap: Spacing.two },
  thumbnailRow: {
    flexDirection: "row",
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  thumbnailContainer: {
    width: 72,
    height: 72,
    borderRadius: Radius.md,
    overflow: "hidden",
  },
  thumbnail: { width: "100%", height: "100%" },
  removeThumbnail: { position: "absolute", top: -6, right: -6 },
  history: { gap: Spacing.two },
  historyList: { gap: 0, paddingVertical: Spacing.one },
  historyItem: { paddingVertical: Spacing.two, gap: Spacing.half },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  historyDate: { marginLeft: "auto" },
});
