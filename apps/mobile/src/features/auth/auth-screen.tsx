import { parseDeepLinkFragment } from "@mizyun/identity";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from "react-native";

import { BrandWordmark } from "@/components/brand-wordmark";
import { GoogleIcon } from "@/components/google-icon";
import { LegalLinks } from "@/components/legal-links";
import { ThemedText } from "@/components/themed-text";
import { Button, Card, FormTextInput, IconBadge } from "@/components/ui";
import { authClient } from "@/composition/auth-client";
import { getAppVariant } from "@/composition/app-variant";
import { mobileConfigResult } from "@/composition/mobile-config";
import {
  MaxContentWidth,
  MinTouchTarget,
  PageGutter,
  Radius,
  Spacing,
} from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

import { authErrorMessage } from "./auth-error-message";
import { useAuth } from "./auth-context";
import { authEntryMode, loadDeviceHadSession } from "./auth-device-history";
import { LoadingScreen } from "./loading-screen";

WebBrowser.maybeCompleteAuthSession();

/**
 * Google Identity branding for the custom "Continue with Google" button
 * (developers.google.com/identity/branding-guidelines). These vendor colours
 * are required by Google's guidelines and intentionally are not app tokens.
 */
const GOOGLE_BUTTON_BRAND = {
  light: { fill: "#FFFFFF", stroke: "#747775", text: "#1F1F1F" },
  dark: { fill: "#131314", stroke: "#8E918F", text: "#E3E3E3" },
} as const;

export function AuthScreen() {
  const { explorePreview } = useAuth();
  const theme = useTheme();
  const scheme = useColorScheme();
  const google = GOOGLE_BUTTON_BRAND[scheme];
  const passwordInput = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "forgot">("sign-in");
  // False until the device history is read, so the screen never flashes sign-in.
  const [entryResolved, setEntryResolved] = useState(false);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<
    string | null
  >(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string>();
  const [emailBusy, setEmailBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [isAppleAuthAvailable, setIsAppleAuthAvailable] = useState(false);

  const busy = emailBusy || googleBusy || appleBusy || resendBusy;
  const isAndroid = Platform.OS === "android";

  useEffect(() => {
    let isMounted = true;
    void loadDeviceHadSession().then((hadSession) => {
      if (!isMounted) return;
      setMode(authEntryMode(hadSession));
      setEntryResolved(true);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (isMounted) setIsAppleAuthAvailable(available);
      })
      .catch(() => {
        if (isMounted) setIsAppleAuthAvailable(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

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
        if (result.emailConfirmationRequired) {
          setPendingConfirmationEmail(email);
          return;
        }
      }
    } catch (error) {
      setMessage(authErrorMessage(mode, error));
    } finally {
      setEmailBusy(false);
    }
  };

  const handleResend = async () => {
    if (!pendingConfirmationEmail) return;
    setResendBusy(true);
    setResendMessage(null);
    try {
      await authClient.signUpWithPassword({
        email: pendingConfirmationEmail,
        password: password || "placeholder-reissue",
      });
      setResendMessage("Verification email resent. Check your inbox!");
    } catch {
      setResendMessage("Verification email resent. Check your inbox!");
    } finally {
      setResendBusy(false);
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

  const submitAppleAuth = async () => {
    setAppleBusy(true);
    setMessage(undefined);
    try {
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      if (!credential.identityToken) {
        throw new Error("Apple Sign In failed to return an identity token.");
      }

      await authClient.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
        nonce: rawNonce,
      });
    } catch (error: any) {
      if (
        error?.code === "ERR_REQUEST_CANCELED" ||
        error?.code === "ERR_CANCELED"
      ) {
        return;
      }
      setMessage(authErrorMessage("apple", error));
    } finally {
      setAppleBusy(false);
    }
  };

  if (!entryResolved) return <LoadingScreen />;

  if (pendingConfirmationEmail) {
    return (
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={[styles.page, { backgroundColor: theme.background }]}
      >
        <View style={styles.hero}>
          <BrandWordmark />
          <ThemedText type="subtitle" style={styles.center}>
            Check your inbox
          </ThemedText>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.center}
          >
            Email verification
          </ThemedText>
        </View>

        <Card style={styles.confirmationCard}>
          <IconBadge name="envelope" size={44} />
          <ThemedText
            type="small"
            themeColor="textSecondary"
            style={styles.center}
          >
            We sent a verification link to:
          </ThemedText>
          <ThemedText type="headline" style={styles.center}>
            {pendingConfirmationEmail}
          </ThemedText>
          <ThemedText
            type="footnote"
            themeColor="textSecondary"
            style={styles.center}
          >
            Click the link in the email to activate your account. Once verified,
            you can sign in to your private fitness space.
          </ThemedText>
        </Card>

        {resendMessage ? (
          <ThemedText
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            type="smallBold"
            themeColor="primary"
            style={styles.center}
          >
            {resendMessage}
          </ThemedText>
        ) : null}

        <Button
          label="Resend verification email"
          block
          loading={resendBusy}
          disabled={resendBusy}
          onPress={handleResend}
        />

        <Button
          label="Back to sign in"
          variant="plain"
          style={styles.centerAction}
          onPress={() => {
            setPendingConfirmationEmail(null);
            setResendMessage(null);
            setMode("sign-in");
          }}
        />
      </ScrollView>
    );
  }

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
      style={[styles.page, { backgroundColor: theme.background }]}
    >
      <View style={styles.hero}>
        <BrandWordmark />
        <ThemedText type="subtitle" style={styles.center}>
          {title}
        </ThemedText>
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={styles.center}
        >
          Your private fitness space
        </ThemedText>
      </View>

      {mode !== "forgot" && (isAppleAuthAvailable || Platform.OS !== "ios") ? (
        <>
          {isAppleAuthAvailable ? (
            appleBusy ? (
              <View
                style={[
                  styles.appleButton,
                  styles.appleButtonLoading,
                  // Mirrors the native Apple button's black/white style.
                  { backgroundColor: theme.text },
                ]}
              >
                <ActivityIndicator color={theme.background} />
              </View>
            ) : (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={
                  AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
                }
                buttonStyle={
                  scheme === "dark"
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={Radius.md}
                style={styles.appleButton}
                onPress={submitAppleAuth}
              />
            )
          ) : null}

          <Pressable
            accessibilityLabel={
              googleBusy
                ? "Signing in with Google"
                : isAndroid
                  ? "Sign in with Google"
                  : "Continue with Google"
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy: googleBusy }}
            disabled={busy}
            onPress={submitGoogleAuth}
            style={({ pressed }) => [
              isAndroid
                ? styles.androidGoogleButton
                : [
                    styles.googleButton,
                    {
                      backgroundColor: google.fill,
                      borderColor: google.stroke,
                    },
                  ],
              isAndroid &&
                googleBusy && [
                  styles.androidGoogleButtonLoading,
                  {
                    backgroundColor: GOOGLE_BUTTON_BRAND.light.fill,
                    borderColor: GOOGLE_BUTTON_BRAND.light.stroke,
                  },
                ],
              pressed && styles.googleButtonPressed,
              busy && !googleBusy && styles.googleButtonDisabled,
            ]}
          >
            {googleBusy ? (
              <ActivityIndicator
                color={isAndroid ? GOOGLE_BUTTON_BRAND.light.text : google.text}
              />
            ) : isAndroid ? (
              <Image
                accessible={false}
                resizeMode="contain"
                source={require("../../../assets/images/google-sign-in-android-light-pill.png")}
                style={styles.androidGoogleButtonImage}
              />
            ) : (
              <>
                <GoogleIcon size={20} />
                <Text style={[styles.googleButtonText, { color: google.text }]}>
                  Continue with Google
                </Text>
              </>
            )}
          </Pressable>
          <View style={styles.dividerRow}>
            <View
              style={[styles.dividerLine, { backgroundColor: theme.separator }]}
            />
            <ThemedText type="footnote" themeColor="textSecondary">
              or continue with email
            </ThemedText>
            <View
              style={[styles.dividerLine, { backgroundColor: theme.separator }]}
            />
          </View>
        </>
      ) : null}

      <Card padded={false} style={styles.inputGroup}>
        <FormTextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="Email"
          returnKeyType={mode === "forgot" ? "done" : "next"}
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={() => {
            if (mode === "forgot" && email) void submit();
            else passwordInput.current?.focus();
          }}
          style={styles.groupedInput}
        />
        {mode !== "forgot" ? (
          <>
            <View
              style={[
                styles.inputSeparator,
                { backgroundColor: theme.separator },
              ]}
            />
            <FormTextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete={
                mode === "sign-in" ? "current-password" : "new-password"
              }
              placeholder="Password"
              ref={passwordInput}
              returnKeyType="done"
              secureTextEntry
              textContentType={mode === "sign-in" ? "password" : "newPassword"}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => {
                if (email && password.length >= 6) void submit();
              }}
              style={styles.groupedInput}
            />
          </>
        ) : null}
      </Card>
      {message ? (
        <ThemedText
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          type="small"
          themeColor="warning"
        >
          {message}
        </ThemedText>
      ) : null}
      <Button
        label={
          mode === "forgot"
            ? "Send reset link"
            : mode === "sign-in"
              ? "Sign in"
              : "Create account"
        }
        block
        loading={emailBusy}
        disabled={busy || !email || (mode !== "forgot" && password.length < 6)}
        onPress={submit}
      />
      <View style={styles.links}>
        {mode === "sign-in" ? (
          <Button
            label="Forgot password?"
            variant="plain"
            style={styles.centerAction}
            onPress={() => setMode("forgot")}
          />
        ) : null}
        <Button
          label={
            mode === "sign-in"
              ? "New here? Create an account"
              : mode === "sign-up"
                ? "Already have an account? Sign in"
                : "Back to sign in"
          }
          variant="plain"
          style={styles.centerAction}
          onPress={() =>
            setMode(
              mode === "sign-in"
                ? "sign-up"
                : mode === "sign-up"
                  ? "sign-in"
                  : "sign-in",
            )
          }
        />
      </View>

      {mode !== "forgot" ? (
        <LegalLinks
          intro={
            mode === "sign-up"
              ? "By creating an account, you agree to the Terms of Service. The Privacy Policy explains how Mizyun handles your data. Mizyun is for adults 18 and over."
              : undefined
          }
        />
      ) : null}

      {getAppVariant() === "dev" ? (
        <Button
          accessibilityLabel="Explore app in preview mode"
          label="Explore app preview"
          variant="tinted"
          icon="sparkles"
          block
          onPress={explorePreview}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: PageGutter,
    paddingVertical: Spacing.five,
    gap: Spacing.three,
  },
  hero: {
    alignItems: "center",
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  center: { textAlign: "center" },
  centerAction: { alignSelf: "center" },
  links: { gap: Spacing.half },
  appleButton: {
    width: "100%",
    height: 50,
  },
  appleButtonLoading: {
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  googleButton: {
    minHeight: 50,
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: Spacing.three,
  },
  googleButtonPressed: { opacity: 0.82 },
  googleButtonDisabled: { opacity: 0.55 },
  googleButtonText: {
    fontWeight: "500",
    fontSize: 16,
    letterSpacing: 0.15,
  },
  androidGoogleButton: {
    alignItems: "center",
    alignSelf: "center",
    height: 52,
    justifyContent: "center",
    width: 234,
  },
  androidGoogleButtonImage: {
    height: 52,
    width: 234,
  },
  androidGoogleButtonLoading: {
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: Spacing.one,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  inputGroup: { overflow: "hidden" },
  groupedInput: {
    minHeight: MinTouchTarget + 6,
    borderRadius: 0,
    backgroundColor: "transparent",
    paddingHorizontal: Spacing.three,
  },
  inputSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.three,
  },
  confirmationCard: {
    alignItems: "center",
    padding: Spacing.four,
    gap: Spacing.two,
  },
});
