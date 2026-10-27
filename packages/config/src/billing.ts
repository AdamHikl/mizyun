/**
 * Store billing (#332, ADR-0080). Purchases and the RevenueCat webhook are on
 * in Dev unless `BILLING_ENABLED=false`; every other environment needs the
 * explicit `BILLING_ENABLED=true`, so Production stays off by default. Either
 * way billing turns on only when the server-side RevenueCat secret API key
 * and webhook signing secret are both present. Sandbox purchases (TestFlight,
 * Play licence testers) grant Pro only in Dev unless `BILLING_ALLOW_SANDBOX`
 * says otherwise.
 */
export interface BillingServerConfig {
  readonly secretApiKey: string;
  readonly webhookSigningSecret: string;
  /** Optional dashboard Authorization header value, checked when set. */
  readonly webhookAuthorization: string | null;
  readonly entitlementId: string;
  readonly offeringId: string | null;
  readonly iosPublicKey: string | null;
  readonly androidPublicKey: string | null;
  readonly allowSandbox: boolean;
}

export type BillingConfigResult =
  | { readonly enabled: true; readonly config: BillingServerConfig }
  | {
      readonly enabled: false;
      readonly reason: "flag_off" | "missing_secrets";
    };

const value = (raw: string | undefined): string | null => {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
};

const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,100}$/;

export const loadBillingConfig = (
  env: Readonly<Record<string, string | undefined>>,
): BillingConfigResult => {
  const isDev = env.MIZYUN_ENVIRONMENT === "dev";
  const flagOn = isDev
    ? env.BILLING_ENABLED !== "false"
    : env.BILLING_ENABLED === "true";
  if (!flagOn) return { enabled: false, reason: "flag_off" };
  const secretApiKey = value(env.REVENUECAT_SECRET_API_KEY);
  const webhookSigningSecret = value(env.REVENUECAT_WEBHOOK_SIGNING_SECRET);
  if (secretApiKey === null || webhookSigningSecret === null) {
    return { enabled: false, reason: "missing_secrets" };
  }
  const entitlementId = value(env.REVENUECAT_ENTITLEMENT_ID) ?? "pro";
  const offeringId = value(env.REVENUECAT_OFFERING_ID);
  return {
    enabled: true,
    config: {
      secretApiKey,
      webhookSigningSecret,
      webhookAuthorization: value(env.REVENUECAT_WEBHOOK_AUTHORIZATION),
      entitlementId: IDENTIFIER.test(entitlementId) ? entitlementId : "pro",
      offeringId:
        offeringId !== null && IDENTIFIER.test(offeringId) ? offeringId : null,
      iosPublicKey: value(env.REVENUECAT_IOS_PUBLIC_KEY),
      androidPublicKey: value(env.REVENUECAT_ANDROID_PUBLIC_KEY),
      allowSandbox:
        env.BILLING_ALLOW_SANDBOX === undefined
          ? isDev
          : env.BILLING_ALLOW_SANDBOX === "true",
    },
  };
};
