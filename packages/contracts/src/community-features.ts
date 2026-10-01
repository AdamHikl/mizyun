import { z } from "zod";
export const communityFeatureSchema = z.enum([
  "comments",
  "groups",
  "challenges",
  "messaging",
  "media",
  "routines",
  "discovery",
]);
export const communityFeatureStatusSchema = z.array(
  z.object({ feature: communityFeatureSchema, enabled: z.boolean() }).strict(),
);

export type CommunityResponseSchema<T> = z.ZodType<T>;
