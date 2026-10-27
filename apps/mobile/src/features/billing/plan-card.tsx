import { applicationId } from "expo-application";
import { openBrowserAsync } from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, Card, Chip, Icon, Notice } from "@/components/ui";
import { apiClient, apiConfiguration } from "@/composition/api-client";
import { MinTouchTarget, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { BillingEntitlementResponse } from "@mizyun/contracts";

import {
  fetchBillingEntitlement,
  syncBillingEntitlement,
} from "./billing-client";
import {
  defaultPlanOption,
  describeCurrentPlan,
  hasStoreSubscription,
  manageSubscriptionUrl,
  offerLabel,
  orderPlanOptions,
  planTitle,
  priceLabel,
  purchaseButtonLabel,
  purchasesAvailable,
  renewalDisclosure,
  storeApiKeyFor,
  trialLabel,
  type PlanOption,
} from "./plan-presentation";
import {
  createStorePurchases,
  loadNativePurchases,
  type StorePurchaseResult,
  type StorePurchases,
  type StoreSession,
} from "./store-purchases";

const defaultStore = createStorePurchases({
  loadModule: loadNativePurchases,
  platform: Platform.OS,
});

type EntitlementState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly response: BillingEntitlementResponse };

type PlansState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ok"; readonly options: readonly PlanOption[] };

type Message = {
  readonly tone: "info" | "success" | "warning";
  readonly text: string;
};

const CONFIRMING: Message = {
  tone: "info",
  text: "Purchase received. Pro turns on as soon as the Store confirms it.",
};

/**
 * "Mizyun Pro" plan screen body. Order: current plan, Store prices, renewal
 * disclosure, purchase, restore, manage/cancel, legal links. The plan shown as
 * Pro always comes from the server response; Store SDK results only move the
 * screen into "confirming" (ADR-0029).
 */
export function PlanCard({
  userId,
  store = defaultStore,
}: {
  readonly userId: string | undefined;
  readonly store?: StorePurchases;
}) {
  const theme = useTheme();
  const mountedRef = useRef(true);
  const [entitlement, setEntitlement] = useState<EntitlementState>({
    kind: "loading",
  });
  const [plans, setPlans] = useState<PlansState>({ kind: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"buy" | "restore" | "refresh" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [awaiting, setAwaiting] = useState(false);

  const sessionFor = useCallback(
    (response: BillingEntitlementResponse): StoreSession | null => {
      const apiKey = storeApiKeyFor(response.storeSdk, Platform.OS);
      if (
        userId === undefined ||
        apiKey === null ||
        response.storeSdk === null
      ) {
        return null;
      }
      return {
        userId,
        apiKey,
        entitlementId: response.storeSdk.entitlementId,
        offeringId: response.storeSdk.offeringId,
      };
    },
    [userId],
  );

  const loadPlans = useCallback(
    async (response: BillingEntitlementResponse) => {
      const session = sessionFor(response);
      if (session === null || !purchasesAvailable(response, Platform.OS)) {
        setPlans({ kind: "unavailable" });
        return;
      }
      setPlans({ kind: "loading" });
      const result = await store.loadPlans(session);
      if (!mountedRef.current) return;
      if (result.kind === "ok") {
        setPlans({ kind: "ok", options: orderPlanOptions(result.options) });
      } else {
        setPlans({ kind: result.kind });
      }
    },
    [sessionFor, store],
  );

  const load = useCallback(async () => {
    setEntitlement({ kind: "loading" });
    const result = await fetchBillingEntitlement(apiClient);
    if (!mountedRef.current) return;
    if (!result.ok) {
      setEntitlement({ kind: "error" });
      return;
    }
    setEntitlement({ kind: "ready", response: result.value });
    await loadPlans(result.value);
  }, [loadPlans]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const sync = useCallback(
    async (
      clientEntitlementActive: boolean,
      kind: "purchase" | "restore" | "refresh",
    ) => {
      const result = await syncBillingEntitlement(apiClient);
      if (!mountedRef.current) return;
      if (result.ok) {
        setEntitlement({ kind: "ready", response: result.value });
        if (result.value.planTier === "paid") {
          setAwaiting(false);
          setMessage({ tone: "success", text: "Mizyun Pro is on. Thank you." });
          return;
        }
      }
      if (clientEntitlementActive || (kind === "purchase" && !result.ok)) {
        setAwaiting(true);
        setMessage(CONFIRMING);
      } else if (kind === "restore") {
        // The server may not have re-read the Store yet (throttled); offer a
        // re-check instead of a definite "nothing found".
        setAwaiting(true);
        setMessage({
          tone: "info",
          text: "No active subscription found yet. If you subscribed, it can take a minute to appear.",
        });
      } else if (kind === "refresh") {
        setMessage(
          result.ok
            ? CONFIRMING
            : {
                tone: "warning",
                text: "Could not check your plan. Try again in a moment.",
              },
        );
      }
    },
    [],
  );

  const handleStoreResult = useCallback(
    async (result: StorePurchaseResult, kind: "purchase" | "restore") => {
      if (!mountedRef.current) return;
      switch (result.kind) {
        case "cancelled":
          return;
        case "pending":
          setMessage({
            tone: "info",
            text: "Your purchase is waiting for approval. Pro turns on once it is approved.",
          });
          return;
        case "failed":
          setMessage({
            tone: "warning",
            text:
              kind === "purchase"
                ? "The purchase did not go through. If you were charged, choose Restore purchases."
                : "Could not restore purchases. Try again in a moment.",
          });
          return;
        case "purchased":
          await sync(result.clientEntitlementActive, kind);
      }
    },
    [sync],
  );

  const run = useCallback(
    async (
      kind: "buy" | "restore",
      action: (session: StoreSession) => Promise<StorePurchaseResult>,
    ) => {
      if (entitlement.kind !== "ready") return;
      const session = sessionFor(entitlement.response);
      if (session === null) return;
      setBusy(kind);
      setMessage(null);
      try {
        const result = await action(session);
        await handleStoreResult(
          result,
          kind === "buy" ? "purchase" : "restore",
        );
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    },
    [entitlement, handleStoreResult, sessionFor],
  );

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setMessage(null);
    try {
      await sync(false, "refresh");
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [sync]);

  const openUrl = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // The Store page could not be opened; the link stays available.
    }
  }, []);

  const openLegal = useCallback(async (path: string) => {
    const baseUrl = apiConfiguration.configured
      ? apiConfiguration.baseUrl
      : "https://mizyun-api.phiskel.com";
    try {
      await openBrowserAsync(`${baseUrl}${path}`);
    } catch {
      // Browser unavailable; nothing else to do.
    }
  }, []);

  if (entitlement.kind === "loading") {
    return (
      <Card>
        <View style={styles.center}>
          <ActivityIndicator />
          <ThemedText type="footnote" themeColor="textSecondary">
            Loading your plan…
          </ThemedText>
        </View>
      </Card>
    );
  }

  if (entitlement.kind === "error") {
    return (
      <Notice
        tone="warning"
        message="Could not load your plan."
        action={
          <Button
            label="Retry"
            variant="plain"
            size="small"
            icon="repeat"
            accessibilityLabel="Retry loading your plan"
            onPress={() => void load()}
          />
        }
      />
    );
  }

  const response = entitlement.response;
  const summary = describeCurrentPlan(response);
  const options = plans.kind === "ok" ? plans.options : [];
  const selected =
    options.find((option) => option.id === selectedId) ??
    defaultPlanOption(options);
  const canBuy = plans.kind === "ok" && selected !== null;
  const canRestore = purchasesAvailable(response, Platform.OS);
  const showManage = true;
  const manageUrl = manageSubscriptionUrl(
    Platform.OS,
    response.entitlement?.productId ?? null,
    applicationId,
  );

  return (
    <View style={styles.page}>
      <Card style={styles.card}>
        <View style={styles.row}>
          <ThemedText type="headline" style={styles.flex}>
            {summary.headline}
          </ThemedText>
          <Chip
            label={summary.isPro ? "Pro" : "Free"}
            icon={summary.isPro ? "sparkles" : undefined}
            tone={summary.isPro ? "primary" : "neutral"}
          />
        </View>
        {summary.detail !== null ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {summary.detail}
          </ThemedText>
        ) : null}
        <ThemedText type="footnote" themeColor="textSecondary">
          Free stays free: logging, history, export and deletion never need Pro.
        </ThemedText>
      </Card>

      {summary.billingNotice !== null ? (
        <Notice tone="warning" message={summary.billingNotice} />
      ) : null}

      {!summary.isPro ? (
        <PricesSection
          plans={plans}
          selected={selected}
          onSelect={setSelectedId}
          onRetry={() => void loadPlans(response)}
          borderColor={theme.border}
          selectedColor={theme.primary}
        />
      ) : null}

      {canBuy && response.planTier === "free" ? (
        <>
          <ThemedText type="footnote" themeColor="textSecondary">
            {renewalDisclosure(Platform.OS)}
          </ThemedText>
          <Button
            label={purchaseButtonLabel(selected)}
            block
            loading={busy === "buy"}
            disabled={busy !== null}
            accessibilityHint={offerLabel(selected)}
            onPress={() =>
              void run("buy", (session) => store.purchase(session, selected.id))
            }
          />
        </>
      ) : null}

      {message !== null ? (
        <Notice tone={message.tone} message={message.text} />
      ) : null}
      {awaiting && response.planTier === "free" ? (
        <Button
          label="Check again"
          variant="tinted"
          icon="repeat"
          block
          loading={busy === "refresh"}
          disabled={busy !== null}
          accessibilityLabel="Check whether Pro is on yet"
          onPress={() => void refresh()}
        />
      ) : null}

      {canRestore ? (
        <Button
          label="Restore purchases"
          variant="secondary"
          block
          loading={busy === "restore"}
          disabled={busy !== null}
          onPress={() =>
            void run("restore", (session) => store.restore(session))
          }
        />
      ) : null}

      {showManage ? (
        <Button
          label="Manage or cancel subscription"
          variant={hasStoreSubscription(response) ? "tinted" : "plain"}
          icon="externalLink"
          block
          accessibilityRole="link"
          accessibilityHint="Opens your Store subscription settings"
          onPress={() => void openUrl(manageUrl)}
        />
      ) : null}

      <View style={styles.legalRow}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open Terms of Use"
          accessibilityHint="Opens in the browser"
          onPress={() => void openLegal("/legal/terms")}
          style={styles.legalLink}
        >
          <ThemedText type="footnote" themeColor="primary">
            Terms of Use
          </ThemedText>
          <Icon name="externalLink" size={13} color="textTertiary" />
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open Privacy Policy"
          accessibilityHint="Opens in the browser"
          onPress={() => void openLegal("/legal/privacy")}
          style={styles.legalLink}
        >
          <ThemedText type="footnote" themeColor="primary">
            Privacy Policy
          </ThemedText>
          <Icon name="externalLink" size={13} color="textTertiary" />
        </Pressable>
      </View>
    </View>
  );
}

function PricesSection({
  plans,
  selected,
  onSelect,
  onRetry,
  borderColor,
  selectedColor,
}: {
  readonly plans: PlansState;
  readonly selected: PlanOption | null;
  readonly onSelect: (id: string) => void;
  readonly onRetry: () => void;
  readonly borderColor: string;
  readonly selectedColor: string;
}) {
  if (plans.kind === "idle" || plans.kind === "unavailable") {
    return (
      <Notice
        tone="info"
        message="Subscriptions aren't available in this build yet."
      />
    );
  }
  if (plans.kind === "loading") {
    return (
      <Card>
        <View style={styles.center}>
          <ActivityIndicator />
          <ThemedText type="footnote" themeColor="textSecondary">
            Loading prices…
          </ThemedText>
        </View>
      </Card>
    );
  }
  if (plans.kind === "failed") {
    return (
      <Notice
        tone="warning"
        message="Prices couldn't load."
        action={
          <Button
            label="Retry"
            variant="plain"
            size="small"
            icon="repeat"
            accessibilityLabel="Retry loading prices"
            onPress={onRetry}
          />
        }
      />
    );
  }
  return (
    <View
      style={styles.options}
      accessibilityRole="radiogroup"
      accessibilityLabel="Mizyun Pro plans"
    >
      {plans.options.map((option) => {
        const isSelected = selected?.id === option.id;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={`${planTitle(option.period)}, ${offerLabel(option)}`}
            onPress={() => onSelect(option.id)}
            style={[
              styles.option,
              {
                borderColor: isSelected ? selectedColor : borderColor,
                borderWidth: isSelected ? 2 : 1,
              },
            ]}
          >
            <View style={styles.flex}>
              <ThemedText type="smallBold">
                {planTitle(option.period)}
              </ThemedText>
              <ThemedText type="default">{priceLabel(option)}</ThemedText>
              {option.trial !== null ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  {trialLabel(option.trial)}
                </ThemedText>
              ) : null}
              {option.monthlyEquivalent !== null ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  {option.monthlyEquivalent} / month
                </ThemedText>
              ) : null}
            </View>
            <Icon
              name={isSelected ? "checkCircle" : "circle"}
              size={22}
              color={isSelected ? "primary" : "textTertiary"}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: Spacing.three },
  card: { gap: Spacing.two },
  center: {
    alignItems: "center",
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  flex: { flex: 1 },
  options: { gap: Spacing.two },
  option: {
    minHeight: MinTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.md,
  },
  legalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.three,
  },
  legalLink: {
    minHeight: MinTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
});
