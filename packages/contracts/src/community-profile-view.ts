import { z } from "zod";
import { publicCommunityProfileDtoSchema } from "./community";

/** Only the viewer's two edges to this identity; never a person's public graph. */
export const communityProfileRelationshipEdgeSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved"]),
});
export const communityProfileViewDtoSchema =
  publicCommunityProfileDtoSchema.extend({
    relationshipContext: z.object({
      outgoing: communityProfileRelationshipEdgeSchema.nullable(),
      incoming: communityProfileRelationshipEdgeSchema.nullable(),
    }),
  });
export type CommunityProfileViewDto = z.infer<
  typeof communityProfileViewDtoSchema
>;
