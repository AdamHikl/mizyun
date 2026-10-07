import React from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useTheme } from "@/hooks/use-theme";
export function ExpansionButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingVertical: 12,
        paddingHorizontal: 4,
        minHeight: 48,
        backgroundColor: "transparent",
        borderBottomWidth: 1,
        borderColor: t.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: t.text, fontWeight: "600", fontSize: 16 }}>
        {label}
      </Text>
    </Pressable>
  );
}
export function ExpansionInput({
  label,
  value,
  onChange,
  maxLength = 1000,
  multiline = true,
  editable = true,
  autoCapitalize = "sentences",
  autoCorrect = true,
  keyboardType,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  maxLength?: number;
  multiline?: boolean;
  editable?: boolean;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoCorrect?: boolean;
  keyboardType?: TextInputProps["keyboardType"];
  onSubmitEditing?: TextInputProps["onSubmitEditing"];
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.text }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        editable={editable}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        keyboardType={keyboardType}
        onSubmitEditing={onSubmitEditing}
        maxLength={maxLength}
        style={{
          padding: 12,
          minHeight: 48,
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: 12,
          color: t.text,
          fontSize: 16,
          textAlignVertical: "top",
          opacity: editable ? 1 : 0.5,
        }}
      />
    </View>
  );
}
