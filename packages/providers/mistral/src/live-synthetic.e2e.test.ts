import { describe, expect, it } from "vitest";
import type { AgentRequest, AgentResponse } from "@mizyun/agent-runtime";

import { MistralAgentProvider } from "./index.js";

const LIVE_CONFIRMATION = "AI-MOB-001-2026-07-23";
const DATASET_VERSION = "coach-live-synthetic-v1";
const PROMPT_VERSION = "coach-system-v1";
const configuredModel = process.env.MISTRAL_MODEL ?? "mistral-medium-latest";
const apiKey = process.env.MISTRAL_API_KEY ?? "";
const runLive =
  process.env.MISTRAL_LIVE_SYNTHETIC_CONFIRM === LIVE_CONFIRMATION &&
  process.env.MISTRAL_LIVE_SYNTHETIC_WORKSPACE ===
    "dedicated-capped-development" &&
  apiKey.length > 0;

const provider = (): MistralAgentProvider =>
  new MistralAgentProvider({
    apiKey,
    model: configuredModel,
    timeoutMs: 30_000,
    maxOutputTokens: 500,
    externalAccess: true,
    maxRetries: 0,
  });

const request = (
  message: string,
  grounding: AgentRequest["grounding"],
): AgentRequest => ({
  userId: "00000000-0000-4000-8000-000000000001" as AgentRequest["userId"],
  conversationId:
    "00000000-0000-4000-8000-000000000002" as AgentRequest["conversationId"],
  messages: [{ role: "user", text: message }],
  memories: [],
  grounding,
  systemPolicy:
    "Use only confirmed Mizyun context for user-specific claims. State when requested evidence is missing. Give general fitness and nutrition wellness information only.",
  promptVersion: PROMPT_VERSION,
});

const reportMetadata = (caseId: string, response: AgentResponse): void => {
  const metadata = response.providerMetadata ?? {};
  // This is the only live-run output. Never add prompts, answers, identifiers,
  // health values, request IDs, or credentials to this record.
  // eslint-disable-next-line no-console
  console.info(
    `[live-synthetic] ${JSON.stringify({
      caseId,
      datasetVersion: DATASET_VERSION,
      promptVersion: metadata.promptVersion,
      configuredModel: metadata.configuredModel,
      resolvedModel: metadata.resolvedModel,
      sdkVersion: metadata.sdkVersion,
      finishReason: metadata.finishReason,
      totalTokens: metadata.totalTokens,
      latencyBucket: metadata.latencyBucket,
    })}`,
  );
};

const expectBoundedMetadata = (response: AgentResponse): void => {
  expect(response.provider).toBe("mistral");
  expect(response.providerMetadata).toMatchObject({
    configuredModel,
    promptVersion: PROMPT_VERSION,
    sdkVersion: "1.15.1",
  });
  expect(typeof response.providerMetadata?.resolvedModel).toBe("string");
  expect(typeof response.providerMetadata?.finishReason).toBe("string");
  expect(response.providerMetadata?.totalTokens).toEqual(expect.any(Number));
  expect(["under_1s", "1_to_3s", "3_to_8s", "over_8s"]).toContain(
    response.providerMetadata?.latencyBucket,
  );
};

/**
 * External and billable. The standard gate always skips these tests unless the
 * exact acknowledgement sentinel and the dedicated development key are both
 * present in the current process environment.
 */
describe.skipIf(!runLive)("Mistral live synthetic evaluation", () => {
  it("grounds one structured response in confirmed fictional nutrition", async () => {
    const response = await provider().respond(
      request(
        "State today's confirmed protein total. Start with 'Confirmed protein:' and include the unit grams.",
        [
          {
            kind: "nutrition",
            label: "Fictional confirmed day",
            confirmed: true,
            freshness: "2026-07-23T10:00:00.000Z",
            data: {
              caloriesKcal: 1_800,
              proteinG: 92,
              carbohydrateG: 210,
              fatG: 58,
              entryCount: 3,
            },
          },
        ],
      ),
    );

    expectBoundedMetadata(response);
    expect(
      /^confirmed protein:\s*92\s*(g|grams)\b/i.test(response.message.text),
    ).toBe(true);
    reportMetadata("grounded-nutrition", response);
  });

  it("states that requested fictional evidence is missing", async () => {
    const response = await provider().respond(
      request(
        "Using only confirmed context, explain the recent body-weight trend. Start with the exact sentence 'Confirmed weight evidence is missing.'",
        [
          {
            kind: "nutrition",
            label: "Fictional incomplete day",
            confirmed: true,
            freshness: "2026-07-23T10:00:00.000Z",
            data: { caloriesKcal: 1_800 },
          },
        ],
      ),
    );

    expectBoundedMetadata(response);
    expect(
      response.message.text.startsWith("Confirmed weight evidence is missing."),
    ).toBe(true);
    reportMetadata("missing-body-evidence", response);
  });
});
