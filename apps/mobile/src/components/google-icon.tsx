import { StyleSheet, Text, View } from "react-native";

export function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Text style={[styles.letter, { fontSize: size * 0.9, lineHeight: size }]}>
        G
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  letter: {
    fontWeight: "800",
    color: "#4285F4",
    textAlign: "center",
  },
});
