import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { CountryFlag } from "@/components/ui/country-flag";
import { Colors, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  COUNTRIES,
  CountryItem,
  getCountryByCode,
  getLocalizedCountryName,
  POPULAR_COUNTRY_CODES,
  searchCountries,
} from "@/lib/country-data";

export interface CountryPickerModalProps {
  readonly visible: boolean;
  readonly selectedCode: string | null | undefined;
  readonly onSelect: (countryCode: string | null) => void;
  readonly onClose: () => void;
}

type ListItem =
  | { readonly type: "reset"; readonly id: "reset" }
  | { readonly type: "header"; readonly id: string; readonly title: string }
  | {
      readonly type: "country";
      readonly id: string;
      readonly country: CountryItem;
    };

export function CountryPickerModal({
  visible,
  selectedCode,
  onSelect,
  onClose,
}: CountryPickerModalProps) {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState("");

  const popularCountries = useMemo(() => {
    return POPULAR_COUNTRY_CODES.map((code) => getCountryByCode(code)).filter(
      (c): c is CountryItem => c !== undefined,
    );
  }, []);

  const listItems = useMemo<readonly ListItem[]>(() => {
    const query = searchQuery.trim();
    if (!query) {
      const items: ListItem[] = [
        { type: "reset", id: "reset" },
        {
          type: "header",
          id: "header-suggested",
          title: "Suggested & Popular",
        },
        ...popularCountries.map((c) => ({
          type: "country" as const,
          id: `suggested-${c.code}`,
          country: c,
        })),
        { type: "header", id: "header-all", title: "All Countries (A–Z)" },
        ...COUNTRIES.map((c) => ({
          type: "country" as const,
          id: `all-${c.code}`,
          country: c,
        })),
      ];
      return items;
    }

    const filtered = searchCountries(query);
    return filtered.map((c) => ({
      type: "country" as const,
      id: `search-${c.code}`,
      country: c,
    }));
  }, [searchQuery, popularCountries]);

  const handleSelect = (code: string | null) => {
    onSelect(code);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
          {/* iOS Sheet drag handle affordance */}
          <View style={styles.handleContainer}>
            <View
              style={[
                styles.handle,
                {
                  backgroundColor: theme.border ?? Colors.dark.border,
                },
              ]}
            />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <ThemedText type="subtitle">Country / Region</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close country picker"
                onPress={onClose}
                style={styles.doneButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <ThemedText type="smallBold" themeColor="primary">
                  Done
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.subtitle}
            >
              Calibrates food nutrition standards, portion sizing, and
              restaurant databases (e.g. EU vs US portion norms).
            </ThemedText>

            {/* Search input */}
            <View
              style={[
                styles.searchRow,
                {
                  backgroundColor:
                    theme.backgroundElement ?? Colors.dark.backgroundElement,
                  borderColor: theme.border ?? Colors.dark.border,
                },
              ]}
            >
              <ThemedText style={styles.searchIcon}>🔍</ThemedText>
              <TextInput
                accessibilityLabel="Search country or territory"
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search country, code (SK, US, +421)..."
                placeholderTextColor={Colors.dark.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {searchQuery.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearchQuery("")}
                  style={styles.clearIcon}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    ✕
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Country List */}
          <FlatList
            data={listItems}
            keyExtractor={(item) => item.id}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            maxToRenderPerBatch={25}
            windowSize={7}
            removeClippedSubviews={Platform.OS === "android"}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={{ textAlign: "center" }}
                >
                  No country found matching &ldquo;{searchQuery}&rdquo;
                </ThemedText>
              </View>
            }
            renderItem={({ item }) => {
              if (item.type === "header") {
                return (
                  <View style={styles.sectionHeader}>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {item.title}
                    </ThemedText>
                  </View>
                );
              }

              if (item.type === "reset") {
                const isSelected =
                  selectedCode === null ||
                  selectedCode === undefined ||
                  selectedCode === "";
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Select global standard, no regional calibration"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => handleSelect(null)}
                    style={({ pressed }) => [
                      styles.countryRow,
                      isSelected && {
                        backgroundColor:
                          theme.backgroundSelected ??
                          Colors.dark.backgroundSelected,
                      },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.rowLeft}>
                      <ThemedText style={styles.resetGlobe}>🌐</ThemedText>
                      <View style={styles.countryNameBlock}>
                        <ThemedText type="default" style={styles.countryName}>
                          Global Standard
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          Default international / USDA guidelines
                        </ThemedText>
                      </View>
                    </View>
                    {isSelected ? (
                      <ThemedText
                        type="subtitle"
                        themeColor="primary"
                        style={styles.checkmark}
                      >
                        ✓
                      </ThemedText>
                    ) : null}
                  </Pressable>
                );
              }

              const country = item.country;
              const isSelected = selectedCode === country.code;
              const localizedName = getLocalizedCountryName(
                country.code,
                country.name,
              );

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${localizedName} (${country.code})`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => handleSelect(country.code)}
                  style={({ pressed }) => [
                    styles.countryRow,
                    isSelected && {
                      backgroundColor:
                        theme.backgroundSelected ??
                        Colors.dark.backgroundSelected,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <CountryFlag code={country.code} size={24} />
                    <View style={styles.countryNameBlock}>
                      <View style={styles.countryNameRow}>
                        <ThemedText
                          type="default"
                          style={styles.countryName}
                          numberOfLines={1}
                        >
                          {localizedName}
                        </ThemedText>
                        <View
                          style={[
                            styles.codeBadge,
                            {
                              backgroundColor:
                                theme.backgroundElement ??
                                Colors.dark.backgroundElement,
                              borderColor: theme.border ?? Colors.dark.border,
                            },
                          ]}
                        >
                          <ThemedText
                            type="smallBold"
                            style={styles.codeBadgeText}
                          >
                            {country.code}
                          </ThemedText>
                        </View>
                      </View>
                      {localizedName !== country.name ? (
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          numberOfLines={1}
                        >
                          {country.name}
                        </ThemedText>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.rowRight}>
                    {country.dialCode ? (
                      <ThemedText
                        type="small"
                        themeColor="textSecondary"
                        style={styles.dialCodeText}
                      >
                        {country.dialCode}
                      </ThemedText>
                    ) : null}
                    {isSelected ? (
                      <ThemedText
                        type="subtitle"
                        themeColor="primary"
                        style={styles.checkmark}
                      >
                        ✓
                      </ThemedText>
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  handleContainer: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  doneButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  subtitle: {
    marginTop: Spacing.one,
    marginBottom: Spacing.three,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    height: 44,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: Spacing.two,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  clearIcon: {
    paddingLeft: Spacing.two,
  },
  listContent: {
    paddingBottom: Spacing.six,
  },
  sectionHeader: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    minHeight: 52,
  },
  pressed: {
    opacity: 0.7,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: Spacing.three,
  },
  resetGlobe: {
    fontSize: 22,
    marginRight: Spacing.three,
  },
  countryNameBlock: {
    flex: 1,
    marginLeft: Spacing.three,
  },
  countryNameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  countryName: {
    fontSize: 15,
    fontWeight: "500",
  },
  codeBadge: {
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  codeBadgeText: {
    fontSize: 11,
    opacity: 0.85,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  dialCodeText: {
    fontSize: 13,
  },
  checkmark: {
    fontWeight: "700",
    marginLeft: Spacing.one,
  },
  emptyState: {
    padding: Spacing.six,
    alignItems: "center",
  },
});
