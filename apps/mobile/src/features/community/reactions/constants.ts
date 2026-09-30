import type { CommunityReactionKind } from "@mizyun/contracts";

export interface ReactionDefinition {
  readonly kind: CommunityReactionKind;
  readonly emoji: string;
  readonly label: string;
}

export const SUPPORTED_REACTIONS: readonly ReactionDefinition[] = [
  { kind: "clap", emoji: "👏", label: "Clap" },
  { kind: "fire", emoji: "🔥", label: "Fire" },
  { kind: "high_five", emoji: "🙌", label: "High five" },
  { kind: "fist_bump", emoji: "👊", label: "Fist bump" },
  { kind: "thumbs_up", emoji: "👍", label: "Thumbs up" },
] as const;

export const REACTION_EMOJIS: Record<CommunityReactionKind, string> = {
  clap: "👏",
  fire: "🔥",
  high_five: "🙌",
  fist_bump: "👊",
  thumbs_up: "👍",
};

export const REACTION_LABELS: Record<CommunityReactionKind, string> = {
  clap: "Clap",
  fire: "Fire",
  high_five: "High five",
  fist_bump: "Fist bump",
  thumbs_up: "Thumbs up",
};
