import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
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
        padding: 14,
        minHeight: 48,
        borderRadius: 12,
        backgroundColor: t.backgroundElement,
        borderWidth: 1,
        borderColor: t.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: t.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
export function ExpansionInput({
  label,
  value,
  onChange,
  maxLength = 1000,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  maxLength?: number;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.text }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline
        maxLength={maxLength}
        style={{
          padding: 12,
          minHeight: 48,
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: 12,
          color: t.text,
        }}
      />
    </View>
  );
}
