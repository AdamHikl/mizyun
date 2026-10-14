import type { ReactNode, Ref } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Chip } from "./segmented";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Form presentation primitives: a labelled field,
 * a token-styled text input, selectable choice chips and a status line.
 */
export function FormField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="footnote" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

export function FormTextInput({
  style,
  ref,
  ...rest
}: TextInputProps & { readonly ref?: Ref<TextInput> }) {
  const theme = useTheme();
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={theme.textTertiary}
      style={[
        styles.input,
        { color: theme.text, backgroundColor: theme.backgroundSelected },
        rest.editable === false && styles.disabled,
        style,
      ]}
      {...rest}
    />
  );
}

export function ChoiceChip({
  label,
  selected,
  onPress,
  disabled,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <Chip
      label={label}
      selected={selected}
      icon={selected ? "check" : undefined}
      disabled={disabled}
      onPress={onPress}
      style={styles.choice}
    />
  );
}

export function ChoiceGroup({ children }: { readonly children: ReactNode }) {
  return <View style={styles.choiceGroup}>{children}</View>;
}

export function FormStatus({
  tone,
  children,
}: {
  readonly tone: "error" | "success" | "neutral";
  readonly children: ReactNode;
}) {
  return (
    <ThemedText
      type="footnote"
      accessibilityRole={tone === "error" ? "alert" : undefined}
      themeColor={
        tone === "error"
          ? "danger"
          : tone === "success"
            ? "primary"
            : "textSecondary"
      }
    >
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  input: {
    minHeight: MinTouchTarget,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.two,
    fontSize: 17,
  },
  disabled: { opacity: 0.5 },
  choiceGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  choice: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
});
