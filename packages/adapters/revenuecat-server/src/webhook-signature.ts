import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * RevenueCat webhook authenticity (ADR-0080). RevenueCat signs
 * `"<t>.<raw body>"` with HMAC-SHA256 and sends
 * `X-RevenueCat-Webhook-Signature: t=<unix seconds>,v1=<hex>`; it recomputes
 * both on every retry. The optional dashboard Authorization header is checked
 * too when configured. Source:
 * https://www.revenuecat.com/docs/integrations/webhooks (checked 2026-10-26).
 */
export type WebhookVerificationFailure =
  | "missing_signature"
  | "malformed_signature"
  | "stale_timestamp"
  | "bad_signature"
  | "bad_authorization";

export interface VerifyWebhookInput {
  readonly rawBody: Buffer;
  readonly signatureHeader: string | undefined;
  readonly authorizationHeader: string | undefined;
  readonly signingSecret: string;
  /** When set, the request's Authorization header must equal it exactly. */
  readonly expectedAuthorization: string | null;
  readonly now: Date;
  readonly toleranceSeconds?: number;
}

export type VerifyWebhookResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: WebhookVerificationFailure };

const DEFAULT_TOLERANCE_SECONDS = 300;

const constantTimeEqual = (a: Buffer, b: Buffer): boolean =>
  a.length === b.length && timingSafeEqual(a, b);

const parseSignatureHeader = (
  header: string,
): {
  readonly timestamp: number;
  readonly signatures: readonly string[];
} | null => {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) return null;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") {
      if (!/^\d{1,12}$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "v1") {
      if (!/^[0-9a-f]{64}$/i.test(value)) return null;
      signatures.push(value.toLowerCase());
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
};

export const signRevenueCatWebhook = (
  rawBody: Buffer,
  signingSecret: string,
  timestampSeconds: number,
): string => {
  const digest = createHmac("sha256", signingSecret)
    .update(`${timestampSeconds}.`)
    .update(rawBody)
    .digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
};

export const verifyRevenueCatWebhook = (
  input: VerifyWebhookInput,
): VerifyWebhookResult => {
  if (input.expectedAuthorization !== null) {
    const received = Buffer.from(input.authorizationHeader ?? "", "utf8");
    const expected = Buffer.from(input.expectedAuthorization, "utf8");
    if (!constantTimeEqual(received, expected)) {
      return { ok: false, reason: "bad_authorization" };
    }
  }
  if (!input.signatureHeader) return { ok: false, reason: "missing_signature" };
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (parsed === null) return { ok: false, reason: "malformed_signature" };
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const expected = createHmac("sha256", input.signingSecret)
    .update(`${parsed.timestamp}.`)
    .update(input.rawBody)
    .digest();
  const matches = parsed.signatures.some((signature) =>
    constantTimeEqual(Buffer.from(signature, "hex"), expected),
  );
  return matches ? { ok: true } : { ok: false, reason: "bad_signature" };
};
