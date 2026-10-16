import {
  communityFeedResponseSchema,
  sharedActivityFeedItemDtoSchema,
  sharedActivityKindSchema,
} from "@mizyun/contracts";

const KNOWN_KINDS: ReadonlySet<string> = new Set(
  sharedActivityKindSchema.options,
);
/** Placeholder identities for items the catch below replaced. */
const unknownKindItems = new WeakSet<object>();
const invalidItems = new WeakSet<object>();

type FeedItem = ReturnType<typeof sharedActivityFeedItemDtoSchema.parse>;

const tolerantItem = sharedActivityFeedItemDtoSchema.catch(({ input }) => {
  const marker = {} as FeedItem;
  const kind =
    typeof input === "object" && input !== null
      ? (input as { activityKind?: unknown }).activityKind
      : undefined;
  if (typeof kind === "string" && !KNOWN_KINDS.has(kind))
    unknownKindItems.add(marker);
  else invalidItems.add(marker);
  return marker;
});

/**
 * Feed and profile-activity pages that skip a card of a future kind this
 * build cannot render, instead of rejecting the whole page. Any other
 * malformed item still fails the page as before.
 */
export const tolerantCommunityFeedResponseSchema =
  communityFeedResponseSchema.extend({
    items: tolerantItem
      .array()
      .superRefine((items, ctx) => {
        if (items.some((item) => invalidItems.has(item)))
          ctx.addIssue({
            code: "custom",
            message: "A shared activity is malformed.",
          });
      })
      .transform((items) =>
        items.filter((item) => !unknownKindItems.has(item)),
      ),
  });
