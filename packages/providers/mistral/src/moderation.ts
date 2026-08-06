import { Mistral } from "@mistralai/mistralai";
import type {
  ContentModerationDecision,
  ContentModerator,
} from "@mizyun/agent-runtime";
import { z } from "zod";

const categoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);

const moderationResultSchema = z
  .object({
    categories: z.record(categoryNameSchema, z.boolean()),
    categoryScores: z.record(
      categoryNameSchema,
      z.number().finite().min(0).max(1),
    ),
  })
  .strict()
  .superRefine((result, context) => {
    const categories = Object.keys(result.categories).sort();
    const scores = Object.keys(result.categoryScores).sort();
    if (
      categories.length === 0 ||
      categories.length !== scores.length ||
      categories.some((category, index) => category !== scores[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Moderation categories and category scores must have the same non-empty keys.",
      });
    }
  });

const moderationResponseSchema = z
  .object({
    id: z.string().trim().min(1).max(256),
    model: z.string().trim().min(1).max(128),
    results: z.array(moderationResultSchema).length(1),
  })
  .strict();

export interface MistralContentModeratorOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly externalAccess: boolean;
  readonly client?: MistralModerationClient;
}

export interface MistralModerationClient {
  moderate(
    request: {
      readonly model: string;
      readonly inputs: string;
    },
    options: { readonly timeoutMs: number },
  ): Promise<unknown>;
}

const sdkClient = (apiKey: string): MistralModerationClient => {
  const client = new Mistral({ apiKey });
  return {
    moderate: async (request, options) =>
      client.classifiers.moderate(request, {
        timeoutMs: options.timeoutMs,
        retries: { strategy: "none" },
      }),
  };
};

export class MistralContentModerator implements ContentModerator {
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #externalAccess: boolean;
  readonly #client: MistralModerationClient;

  constructor(options: MistralContentModeratorOptions) {
    this.#model = options.model;
    this.#timeoutMs = options.timeoutMs;
    this.#externalAccess = options.externalAccess;
    this.#client = options.client ?? sdkClient(options.apiKey);
  }

  async moderateText(input: {
    readonly text: string;
    readonly direction: "input" | "output";
  }): Promise<ContentModerationDecision> {
    if (!this.#externalAccess) {
      throw new Error("External moderation access is disabled.");
    }

    const raw = await this.#client.moderate(
      {
        model: this.#model,
        inputs: input.text,
      },
      { timeoutMs: this.#timeoutMs },
    );
    const parsed = moderationResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("The moderation provider returned an invalid response.");
    }

    const result = parsed.data.results[0];
    if (result === undefined) {
      throw new Error("The moderation provider returned no decision.");
    }
    const blockedCategories = Object.entries(result.categories)
      .filter(
        ([category, blocked]) =>
          // The provider's `health` category covers tailored medical advice,
          // which overlaps grounded nutrition/fitness wellness output. Medical
          // inputs remain blocked, while generated text is still protected by
          // the adapter's deterministic unsafe-output screen.
          blocked && !(input.direction === "output" && category === "health"),
      )
      .map(([category]) => category)
      .sort((left, right) => {
        const scoreDifference =
          (result.categoryScores[right] ?? Number.NEGATIVE_INFINITY) -
          (result.categoryScores[left] ?? Number.NEGATIVE_INFINITY);
        return scoreDifference === 0
          ? left.localeCompare(right)
          : scoreDifference;
      });
    const category = blockedCategories[0];
    if (category === undefined) {
      return {
        allowed: true,
        provider: "mistral",
        model: parsed.data.model,
      };
    }
    return {
      allowed: false,
      provider: "mistral",
      model: parsed.data.model,
      category,
    };
  }
}
