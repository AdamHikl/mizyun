import { z } from "zod";

/**
 * The fields Mizyun reads from a RevenueCat webhook. The event is only a
 * trigger: entitlement state is re-read from the REST API, so only identity
 * fields matter here. Unknown fields are ignored. Source:
 * https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 * (checked 2026-10-26).
 */
// Identity fields are read leniently: a malformed alias must not make
// RevenueCat retry a whole event; non-UUID values are dropped below.
const looseIds = z.unknown().optional();
const looseId = z.unknown().optional();

const revenueCatWebhookSchema = z.object({
  event: z
    .object({
      id: z.string().min(1).max(200),
      type: z.string().min(1).max(64),
      app_user_id: looseId,
      original_app_user_id: looseId,
      aliases: looseIds,
      transferred_from: looseIds,
      transferred_to: looseIds,
    })
    .passthrough(),
});

export interface RevenueCatWebhookEvent {
  readonly id: string;
  readonly type: string;
  /** Distinct identifiers named by the event that look like Mizyun user ids. */
  readonly candidateUserIds: readonly string[];
}

const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const parseRevenueCatWebhook = (
  body: unknown,
): RevenueCatWebhookEvent | null => {
  const parsed = revenueCatWebhookSchema.safeParse(body);
  if (!parsed.success) return null;
  const event = parsed.data.event;
  // Anonymous ($RCAnonymousID:…) and foreign ids are never Mizyun accounts.
  const list = (value: unknown): readonly unknown[] =>
    Array.isArray(value) ? value : [];
  const named: readonly unknown[] = [
    event.app_user_id,
    event.original_app_user_id,
    ...list(event.aliases),
    ...list(event.transferred_from),
    ...list(event.transferred_to),
  ];
  const candidateUserIds = [
    ...new Set(
      named.filter(
        (value): value is string =>
          typeof value === "string" && USER_ID_PATTERN.test(value),
      ),
    ),
  ].slice(0, 10);
  return { id: event.id, type: event.type, candidateUserIds };
};
