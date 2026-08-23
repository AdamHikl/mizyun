import { parseDeepLinkFragment } from "@mizyun/identity";
import * as WebBrowser from "expo-web-browser";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { GoogleIcon } from "@/components/google-icon";
import { authClient } from "@/composition/auth-client";
import { mobileConfigResult } from "@/composition/mobile-config";

import { authErrorMessage } from "./auth-error-message";

WebBrowser.maybeCompleteAuthSession();

export function AuthScreen() {
  const passwordInput = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "forgot">("sign-in");
  const [message, setMessage] = useState<string>();
  const [emailBusy, setEmailBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const busy = emailBusy || googleBusy;

  const submit = async () => {
    setEmailBusy(true);
    setMessage(undefined);
    try {
      if (mode === "forgot") {
        await authClient.requestPasswordRecovery({ email });
        setMessage(
          "If an account exists for this email, a reset link is on its way.",
        );
        setMode("sign-in");
        return;
      }
      if (mode === "sign-in") {
        await authClient.signInWithPassword({ email, password });
      } else {
        const result = await authClient.signUpWithPassword({ email, password });
        if (result.emailConfirmationRequired)
          setMessage("Check your email to confirm your account.");
      }
    } catch (error) {
      setMessage(authErrorMessage(mode, error));
    } finally {
      setEmailBusy(false);
    }
  };

  const submitGoogleAuth = async () => {
    setGoogleBusy(true);
    setMessage(undefined);
    try {
      const { url } = await authClient.signInWithOAuth({ provider: "google" });
      const redirectUri =
        (mobileConfigResult.ok && mobileConfigResult.value.authRedirectUri) ||
        "mizyun://auth/callback";
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
      if (result.type === "success" && result.url) {
        const payload = parseDeepLinkFragment(result.url);
        if (payload) {
          await authClient.consumeDeepLink(payload);
        }
      }
    } catch (error) {
      setMessage(authErrorMessage("oauth", error));
    } finally {
      setGoogleBusy(false);
    }
  };

  const title =
    mode === "forgot"
      ? "Reset your password"
      : mode === "sign-in"
        ? "Welcome back"
        : "Create your space";

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.content}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={styles.page}
    >
      <Text style={styles.eyebrow}>YOUR PRIVATE FITNESS SPACE</Text>
      <Text style={styles.title}>{title}</Text>

      {mode !== "forgot" ? (
        <>
          <Pressable
            accessibilityLabel="Continue with Google"
            accessibilityRole="button"
            disabled={busy}
            onPress={submitGoogleAuth}
            style={({ pressed }) => [
              styles.googleButton,
              pressed && styles.googleButtonPressed,
            ]}
          >
            {googleBusy ? (
              <ActivityIndicator color="#1f1f1f" />
            ) : (
              <>
                <GoogleIcon size={20} />
                <Text style={styles.googleButtonText}>
                  Continue with Google
                </Text>
              </>
            )}
          </Pressable>
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or continue with email</Text>
            <View style={styles.dividerLine} />
          </View>
        </>
      ) : null}

      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor="#8E8E93"
        returnKeyType={mode === "forgot" ? "done" : "next"}
        value={email}
        onChangeText={setEmail}
        onSubmitEditing={() => {
          if (mode === "forgot" && email) void submit();
          else passwordInput.current?.focus();
        }}
        style={styles.input}
      />
      {mode !== "forgot" ? (
        <TextInput
          autoCapitalize="none"
          autoComplete={
            mode === "sign-in" ? "current-password" : "new-password"
          }
          placeholder="Password"
          placeholderTextColor="#8E8E93"
          ref={passwordInput}
          returnKeyType="done"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => {
            if (email && password.length >= 6) void submit();
          }}
          style={styles.input}
        />
      ) : null}
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.message}
        >
          {message}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !email || (mode !== "forgot" && password.length < 6)}
        onPress={submit}
        style={styles.primary}
      >
        {emailBusy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>
            {mode === "forgot"
              ? "Send reset link"
              : mode === "sign-in"
                ? "Sign in"
                : "Create account"}
          </Text>
        )}
      </Pressable>
      {mode === "sign-in" ? (
        <Pressable onPress={() => setMode("forgot")}>
          <Text style={styles.switch}>Forgot password?</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() =>
          setMode(
            mode === "sign-in"
              ? "sign-up"
              : mode === "sign-up"
                ? "sign-in"
                : "sign-in",
          )
        }
      >
        <Text style={styles.switch}>
          {mode === "sign-in"
            ? "New here? Create an account"
            : mode === "sign-up"
              ? "Already have an account? Sign in"
              : "Back to sign in"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f7f8f4" },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 28,
    gap: 14,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: "#51705d",
  },
  title: { fontSize: 34, fontWeight: "700", color: "#132019", marginBottom: 8 },
  googleButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#747775",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginTop: 4,
    paddingHorizontal: 16,
  },
  googleButtonPressed: {
    backgroundColor: "#f8f9fa",
    borderColor: "#5e615f",
  },
  googleButtonText: {
    color: "#1f1f1f",
    fontWeight: "600",
    fontSize: 16,
    letterSpacing: 0.15,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e0e6e2",
  },
  dividerText: {
    fontSize: 13,
    color: "#73887c",
    fontWeight: "500",
  },
  input: {
    backgroundColor: "#fff",
    borderColor: "#d6ded8",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    color: "#132019",
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
