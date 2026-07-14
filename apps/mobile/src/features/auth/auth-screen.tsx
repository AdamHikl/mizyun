import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { authClient } from "@/composition/auth-client";

export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      if (mode === "sign-in")
        await authClient.signInWithPassword({ email, password });
      else {
        const result = await authClient.signUpWithPassword({ email, password });
        if (result.emailConfirmationRequired)
          setMessage("Check your email to confirm your account.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>YOUR PRIVATE FITNESS SPACE</Text>
      <Text style={styles.title}>
        {mode === "sign-in" ? "Welcome back" : "Create your space"}
      </Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
      />
      <TextInput
        autoCapitalize="none"
        autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={styles.input}
      />
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !email || password.length < 6}
        onPress={submit}
        style={styles.primary}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </Text>
        )}
      </Pressable>
      <Pressable
        onPress={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
      >
        <Text style={styles.switch}>
          {mode === "sign-in"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 28,
    gap: 14,
    backgroundColor: "#f7f8f4",
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: "#51705d",
  },
  title: { fontSize: 34, fontWeight: "700", color: "#132019", marginBottom: 8 },
  input: {
    backgroundColor: "#fff",
    borderColor: "#d6ded8",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
  },
  message: { color: "#75531b", lineHeight: 20 },
  primary: {
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#18633d",
    marginTop: 4,
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  switch: {
    textAlign: "center",
    color: "#18633d",
    padding: 10,
    fontWeight: "600",
  },
});
