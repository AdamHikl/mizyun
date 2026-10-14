import React, { Children, isValidElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { Link, useRouter, type Href } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { TabHeader } from "@/components/tab-header";
import { ThemedText } from "@/components/themed-text";
import {
  Card,
  Icon,
  IconBadge,
  SectionHeader,
  type IconName,
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

/** Track inset around the segments (keeps 4 x 25% exactly inside the track). */
const trackInset = 2;

/**
 * Segmented switch between the four Community destinations. Each segment is a
 * router link exposed as a tab; segments wrap into rows at large text sizes so
 * labels are never truncated.
 */
export function CommunityNavigation({
  selected,
}: {
  selected: CommunityDestination;
}) {
  const colors = useTheme();
  const { fontScale, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigationWidth =
    Math.min(width - insets.left - insets.right, MaxContentWidth) -
    PageGutter * 2 -
    trackInset * 2;
  // Leave room for the longest label at the user's chosen text size.
  const labelWidth = 80 * fontScale;
  // Bases leave room for the track gap; flexGrow fills each row exactly,
  // so four, two or one segments sit on a row without overflowing.
  const destinationWidth =
    navigationWidth >= labelWidth * 4
      ? "23%"
      : navigationWidth >= labelWidth * 2
        ? "48%"
        : "100%";
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Community sections"
      style={[
        styles.navigation,
        // Four columns stay on one row; percentage bases alone can round
        // past the row width and wrap.
        destinationWidth === "23%" && styles.navigationSingleRow,
        { backgroundColor: colors.backgroundSelected },
      ]}
    >
      {destinations.map(({ key, label, href }) => {
        const current = key === selected;
        return (
          <Link key={key} href={href} asChild>
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: current }}
              // Router links need one flat style object.
              style={StyleSheet.flatten([
                styles.destination,
                { flexBasis: destinationWidth },
                current
                  ? {
                      backgroundColor: colors.backgroundElement,
                      shadowColor: colors.text,
                    }
                  : styles.destinationIdle,
              ])}
            >
              <ThemedText
                type="smallBold"
                themeColor={current ? "text" : "textSecondary"}
                style={styles.destinationText}
              >
                {label}
              </ThemedText>
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}

/**
 * Header for the four root Community destinations: the shared tab header with
 * the Community title, the updates bell and the destination switch.
 */
export function CommunityRootHeader({
  selected,
  onLayout,
}: {
  selected: CommunityDestination;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const colors = useTheme();
  return (
    <TabHeader
      title="Community"
      onLayout={onLayout}
      actions={
        <Link href="/community/inbox" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Community updates"
            style={StyleSheet.flatten(styles.iconButton)}
          >
            <View
              accessible={false}
              style={[
                styles.iconCircle,
                { backgroundColor: colors.backgroundSelected },
              ]}
            >
              <Icon name="bell" size={19} color="text" />
            </View>
          </Pressable>
        </Link>
      }
    >
      <View style={styles.navigationBar}>
        <CommunityNavigation selected={selected} />
      </View>
    </TabHeader>
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
  // Community stack screens hide the native header, so pushed screens get a
  // clean back + title header here; root destinations get the tab header.
  const heading = destination ? (
    <CommunityRootHeader selected={destination} />
  ) : (
    <View style={styles.pageHeader}>
      <View style={styles.barRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={StyleSheet.flatten(styles.back)}
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace(backHref)
          }
        >
          <Icon name="back" size={17} color="primary" />
          <ThemedText type="default" themeColor="primary">
            Back
          </ThemedText>
        </Pressable>
        {headerRight ? (
          <View style={styles.headerRight}>{headerRight}</View>
        ) : null}
      </View>
      <ThemedText
        type="subtitle"
        accessibilityRole="header"
        style={styles.pageTitle}
      >
        {title}
      </ThemedText>
    </View>
  );
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.page, { backgroundColor: colors.background }]}
    >
      {heading}
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {description ? (
            <ThemedText type="small" themeColor="textSecondary">
              {description}
            </ThemedText>
          ) : null}
          {children}
        </ScrollView>
      ) : (
        <View style={styles.fixedContent}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/**
 * Section header above one grouped card of rows or content. A card of rows
 * reads like an inset grouped list: rows sit flush and the last row's
 * hairline is clipped, so separators appear only between rows.
 */
export function CommunitySection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  const rowsOnly =
    items.length > 0 &&
    items.every((item) => isValidElement(item) && item.type === CommunityRow);
  return (
    <View style={styles.section}>
      <SectionHeader title={title} />
      {description ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {description}
        </ThemedText>
      ) : null}
      {rowsOnly ? (
        <Card style={[styles.sectionCard, styles.rowsCard]}>
          <View style={styles.clipLastSeparator}>{children}</View>
        </Card>
      ) : (
        <Card style={styles.sectionCard}>{children}</Card>
      )}
    </View>
  );
}

/** One grouped-list row: navigation, setting or action. */
export function CommunityRow({
  title,
  description,
  href,
  onPress,
  trailing,
  icon,
  danger = false,
  disabled = false,
}: {
  title: string;
  description?: string;
  href?: Href;
  onPress?: () => void;
  trailing?: ReactNode;
  /** Optional leading icon badge. */
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
}) {
  const colors = useTheme();
  const content = (
    <>
      {icon ? (
        <IconBadge name={icon} tone={danger ? "danger" : "primary"} />
      ) : null}
      <View style={styles.rowCopy}>
        <ThemedText type="default" themeColor={danger ? "danger" : "text"}>
          {title}
        </ThemedText>
        {description ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {description}
          </ThemedText>
        ) : null}
      </View>
      {trailing ??
        (href || onPress ? (
          <Icon name="chevronRight" size={14} color="textTertiary" />
        ) : null)}
    </>
  );
  const rowStyle = StyleSheet.flatten([
    styles.row,
    { borderBottomColor: colors.separator, opacity: disabled ? 0.45 : 1 },
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

/**
 * Community action button. Tones map onto the design-system `Button`
 * variants: `primary` is primary, `secondary` is tinted and `danger` is
 * destructive. Kept as a flat-styled Pressable so it can sit inside router
 * links.
 */
export function CommunityButton({
  label,
  onPress,
  href,
  disabled = false,
  busy = false,
  tone = "secondary",
  size = "regular",
}: {
  label: string;
  onPress?: () => void;
  href?: Href;
  disabled?: boolean;
  busy?: boolean;
  tone?: "primary" | "secondary" | "danger";
  /** Compact pill for rows of equal-weight actions. */
  size?: "regular" | "small";
}) {
  const colors = useTheme();
  const palette = {
    primary: { bg: colors.primary, fg: colors.onPrimary },
    secondary: { bg: colors.primaryLight, fg: colors.primary },
    danger: { bg: colors.dangerLight, fg: colors.danger },
  }[tone];
  const style = StyleSheet.flatten([
    styles.button,
    size === "small" && styles.buttonSmall,
    {
      backgroundColor: palette.bg,
      opacity: disabled || busy ? 0.45 : 1,
    },
  ]);
  const content = (
    <>
      {busy ? <ActivityIndicator size="small" color={palette.fg} /> : null}
      <ThemedText
        type={size === "small" ? "smallBold" : "headline"}
        style={[styles.buttonText, { color: palette.fg }]}
      >
        {label}
      </ThemedText>
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
  disabled = false,
}: {
  userId: string;
  displayName: string;
  handle?: string;
  avatarKey?: string;
  onPress?: () => void;
  /** Read-only snapshots show identity without a profile navigation. */
  disabled?: boolean;
}) {
  const content = (
    <>
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
        <ThemedText type="headline">{displayName}</ThemedText>
        {handle ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            @{handle}
          </ThemedText>
        ) : null}
      </View>
    </>
  );
  if (disabled)
    return (
      <View
        accessible
        accessibilityLabel={handle ? `${displayName}, @${handle}` : displayName}
        style={StyleSheet.flatten(styles.identity)}
      >
        {content}
      </View>
    );
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
        {content}
      </Pressable>
    </Link>
  );
}

/** Loading, empty, unavailable or signed-out state (EmptyState look). */
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
    <View style={styles.state} accessibilityState={{ busy }}>
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      <ThemedText
        type="headline"
        accessibilityRole="header"
        style={styles.center}
      >
        {title}
      </ThemedText>
      {description ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.center}
        >
          {description}
        </ThemedText>
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
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  fixedContent: {
    flex: 1,
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
  },
  iconButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  navigationBar: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
  },
  navigation: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderRadius: Radius.md,
    padding: trackInset,
  },
  navigationSingleRow: { flexWrap: "nowrap" },
  destination: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "23%",
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.two,
    borderRadius: Radius.sm + 2,
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  destinationIdle: {
    backgroundColor: "transparent",
    shadowOpacity: 0,
    elevation: 0,
  },
  destinationText: { textAlign: "center" },
  pageHeader: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingBottom: Spacing.two,
  },
  barRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  back: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingRight: Spacing.three,
    marginLeft: -Spacing.one,
  },
  headerRight: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  pageTitle: { marginTop: Spacing.half },
  section: { gap: Spacing.two },
  sectionCard: { paddingVertical: Spacing.two },
  rowsCard: { paddingVertical: 0, overflow: "hidden" },
  // Pull the content up under the card's clipped bottom edge so the last
  // row's bottom hairline is hidden.
  clipLastSeparator: { marginBottom: -StyleSheet.hairlineWidth },
  row: {
    minHeight: MinTouchTarget + 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: Spacing.half },
  button: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderRadius: Radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  buttonSmall: {
    paddingHorizontal: 14,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  buttonText: { textAlign: "center", flexShrink: 1 },
  identity: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  state: {
    alignItems: "center",
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  center: { textAlign: "center" },
});
