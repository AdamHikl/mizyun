import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Link, useRouter, type Href } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { TabHeader } from "@/components/tab-header";
import { BottomTabInset, MaxContentWidth } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { InitialsAvatar } from "../initials-avatar";

export type CommunityDestination = "feed" | "people" | "messages" | "me";
const destinations: readonly {
  key: CommunityDestination;
  label: string;
  href: Href;
}[] = [
  { key: "feed", label: "Feed", href: "/(tabs)/community" },
  { key: "people", label: "People", href: "/(tabs)/community/people" as Href },
  {
    key: "messages",
    label: "Messages",
    href: "/(tabs)/community/messages" as Href,
  },
  { key: "me", label: "Me", href: "/(tabs)/community/me" as Href },
];

export function CommunityNavigation({
  selected,
}: {
  selected: CommunityDestination;
}) {
  const colors = useTheme();
  const { fontScale, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigationWidth =
    Math.min(width - insets.left - insets.right, MaxContentWidth) - 40;
  // Leave room for the longest label at the user's chosen text size.
  const labelWidth = 88 * fontScale;
  const destinationWidth =
    navigationWidth >= labelWidth * 4
      ? "25%"
      : navigationWidth >= labelWidth * 2
        ? "50%"
        : "100%";
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.navigation, { borderBottomColor: colors.border }]}
    >
      {destinations.map(({ key, label, href }) => (
        <Link key={key} href={href} asChild>
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: key === selected }}
            style={StyleSheet.flatten([
              styles.destination,
              { flexBasis: destinationWidth },
              {
                borderBottomColor:
                  key === selected ? colors.primary : "transparent",
              },
            ])}
          >
            <Text
              style={[
                styles.destinationText,
                {
                  color:
                    key === selected ? colors.primary : colors.textSecondary,
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

export function CommunityRootHeader({
  selected,
}: {
  selected: CommunityDestination;
}) {
  const colors = useTheme();
  return (
    <View style={styles.rootHeader}>
      <View style={styles.titleRow}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          Community
        </Text>
        <Link href="/community/inbox" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Community updates"
            style={StyleSheet.flatten(styles.iconButton)}
          >
            <SymbolView
              name={{
                ios: "bell",
                android: "notifications",
                web: "notifications",
              }}
              size={23}
              tintColor={colors.text}
              accessible={false}
            />
          </Pressable>
        </Link>
      </View>
      <CommunityNavigation selected={selected} />
    </View>
  );
}

export function CommunityPage({
  title,
  description,
  destination,
  backHref = "/(tabs)/community",
  headerRight,
  children,
  scroll = true,
}: {
  title: string;
  description?: string;
  destination?: CommunityDestination;
  backHref?: Href;
  headerRight?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
}) {
  const colors = useTheme();
  const router = useRouter();
  const heading = destination ? (
    <CommunityRootHeader selected={destination} />
  ) : (
    <View style={styles.pageHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.back}
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace(backHref)
        }
      >
        <Text style={[styles.backText, { color: colors.primary }]}>‹ Back</Text>
      </Pressable>
      <View style={styles.titleRow}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          {title}
        </Text>
        {headerRight}
      </View>
    </View>
  );
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.page, { backgroundColor: colors.background }]}
    >
      <TabHeader />
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {heading}
          {destination && title !== "Community" ? (
            <Text
              accessibilityRole="header"
              style={[styles.sectionTitle, { color: colors.text }]}
            >
              {title}
            </Text>
          ) : null}
          {description ? (
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              {description}
            </Text>
          ) : null}
          {children}
        </ScrollView>
      ) : (
        <View style={styles.fixedContent}>
          {heading}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

export function CommunitySection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const colors = useTheme();
  return (
    <View style={styles.section}>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: colors.text }]}
      >
        {title}
      </Text>
      {description ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {description}
        </Text>
      ) : null}
      <View>{children}</View>
    </View>
  );
}

export function CommunityRow({
  title,
  description,
  href,
  onPress,
  trailing,
  danger = false,
  disabled = false,
}: {
  title: string;
  description?: string;
  href?: Href;
  onPress?: () => void;
  trailing?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  const colors = useTheme();
  const content = (
    <>
      <View style={styles.rowCopy}>
        <Text
          style={[styles.rowTitle, { color: danger ? "#DC2626" : colors.text }]}
        >
          {title}
        </Text>
        {description ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing ??
        (href || onPress ? (
          <Text
            accessible={false}
            style={[styles.chevron, { color: colors.textSecondary }]}
          >
            ›
          </Text>
        ) : null)}
    </>
  );
  const rowStyle = StyleSheet.flatten([
    styles.row,
    { borderBottomColor: colors.border, opacity: disabled ? 0.5 : 1 },
  ]);
  if (href)
    return (
      <Link href={href} asChild>
        <Pressable
          style={rowStyle}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint={description}
          disabled={disabled}
        >
          {content}
        </Pressable>
      </Link>
    );
  if (onPress)
    return (
      <Pressable
        style={rowStyle}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={description}
        disabled={disabled}
        onPress={onPress}
      >
        {content}
      </Pressable>
    );
  return <View style={rowStyle}>{content}</View>;
}

export function CommunityButton({
  label,
  onPress,
  href,
  disabled = false,
  busy = false,
  tone = "secondary",
}: {
  label: string;
  onPress?: () => void;
  href?: Href;
  disabled?: boolean;
  busy?: boolean;
  tone?: "primary" | "secondary" | "danger";
}) {
  const colors = useTheme();
  const primary = tone === "primary";
  const ink =
    tone === "danger" ? "#DC2626" : primary ? "#FFFFFF" : colors.primary;
  const style = StyleSheet.flatten([
    styles.button,
    {
      backgroundColor: primary ? "#047857" : colors.backgroundElement,
      borderColor: primary ? "#047857" : colors.border,
      opacity: disabled || busy ? 0.5 : 1,
    },
  ]);
  const content = (
    <>
      {busy ? <ActivityIndicator color={ink} /> : null}
      <Text style={[styles.buttonText, { color: ink }]}>{label}</Text>
    </>
  );
  const props = {
    style,
    disabled: disabled || busy,
    accessibilityRole: "button" as const,
    accessibilityLabel: label,
    accessibilityState: { disabled: disabled || busy, busy },
  };
  return href ? (
    <Link href={href} asChild>
      <Pressable {...props}>{content}</Pressable>
    </Link>
  ) : (
    <Pressable {...props} onPress={onPress}>
      {content}
    </Pressable>
  );
}

export function CommunityIdentityLink({
  userId,
  displayName,
  handle,
  avatarKey,
  onPress,
}: {
  userId: string;
  displayName: string;
  handle?: string;
  avatarKey?: string;
  onPress?: () => void;
}) {
  const colors = useTheme();
  return (
    <Link
      href={
        { pathname: "/community/profile/[userId]", params: { userId } } as Href
      }
      asChild
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${displayName}'s profile`}
        onPress={onPress}
        style={StyleSheet.flatten(styles.identity)}
      >
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <InitialsAvatar
            symbol={avatarKey ?? displayName.slice(0, 2)}
            size={40}
            seed={userId}
          />
        </View>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>
            {displayName}
          </Text>
          {handle ? (
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              @{handle}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

export function CommunityState({
  title,
  description,
  busy = false,
  action,
}: {
  title: string;
  description?: string;
  busy?: boolean;
  action?: ReactNode;
}) {
  const colors = useTheme();
  return (
    <View style={styles.state}>
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: colors.text }]}
      >
        {title}
      </Text>
      {description ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {description}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingBottom: BottomTabInset + 24,
    gap: 16,
  },
  fixedContent: {
    flex: 1,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: 20,
  },
  rootHeader: { gap: 2 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    justifyContent: "space-between",
  },
  title: { flex: 1, fontSize: 28, lineHeight: 36, fontWeight: "700" },
  iconButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  navigation: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  destination: {
    flexGrow: 1,
    flexBasis: "25%",
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 10,
    borderBottomWidth: 2,
  },
  destinationText: { fontSize: 15, fontWeight: "600", textAlign: "center" },
  pageHeader: { gap: 4 },
  back: {
    minHeight: 48,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingRight: 20,
  },
  backText: { fontSize: 16, fontWeight: "600" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 22 },
  row: {
    minHeight: 64,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontSize: 16, lineHeight: 23, fontWeight: "600" },
  chevron: { fontSize: 24 },
  button: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
  identity: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  state: { paddingVertical: 24, gap: 12 },
});
