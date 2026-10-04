import assert from "node:assert/strict";
import test from "node:test";

import { validateCoachFeatureKnowledge } from "./check-coach-feature-knowledge.mjs";

function fixture() {
  return {
    capabilities: [
      {
        id: "recurring-meals",
        featureIds: ["nutrition"],
        routes: ["recurring-meals.tsx"],
        guidance:
          "Meals → Repeat → Save schedule enables recurring saved meals.",
      },
    ],
    internalFeatures: [{ id: "database", reason: "Server infrastructure." }],
    featureIds: ["nutrition", "database"],
    routes: ["recurring-meals.tsx"],
  };
}

test("accepts complete explicit coverage and shared feature ownership", () => {
  const input = fixture();
  input.capabilities.push({
    id: "meal-history",
    featureIds: ["nutrition"],
    routes: ["meal-history.tsx"],
    guidance: "Search meal history in Meals.",
  });
  input.routes.push("meal-history.tsx");
  assert.deepEqual(validateCoachFeatureKnowledge(input), []);
});

test("a new repository feature requires an explicit knowledge decision", () => {
  const input = fixture();
  input.featureIds.push("new-user-feature");
  assert.match(
    validateCoachFeatureKnowledge(input).join("\n"),
    /no Coach knowledge classification: new-user-feature/,
  );
});

test("a new mobile route requires a capability owner", () => {
  const input = fixture();
  input.routes.push("new-feature.tsx");
  assert.match(
    validateCoachFeatureKnowledge(input).join("\n"),
    /no Coach capability owner: new-feature.tsx/,
  );
});

test("removing or renaming a route rejects stale catalog directions", () => {
  const input = fixture();
  input.routes = ["renamed-meals.tsx"];
  const errors = validateCoachFeatureKnowledge(input).join("\n");
  assert.match(errors, /Unknown route in recurring-meals: recurring-meals.tsx/);
  assert.match(errors, /no Coach capability owner: renamed-meals.tsx/);
});

test("rejects empty user guidance and internal classification explanations", () => {
  const input = fixture();
  input.capabilities[0].guidance = "  ";
  input.internalFeatures[0].reason = "";
  const errors = validateCoachFeatureKnowledge(input).join("\n");
  assert.match(errors, /recurring-meals has empty guidance/);
  assert.match(errors, /database has an empty reason/);
});

test("rejects dangling feature references and internal entries", () => {
  const input = fixture();
  input.capabilities[0].featureIds.push("removed-feature");
  input.internalFeatures.push({
    id: "removed-internal",
    reason: "Old server feature.",
  });
  const errors = validateCoachFeatureKnowledge(input).join("\n");
  assert.match(errors, /Unknown feature in recurring-meals: removed-feature/);
  assert.match(errors, /Unknown internal feature: removed-internal/);
});

test("rejects duplicate ids, routes, and local feature references", () => {
  const input = fixture();
  input.capabilities[0].featureIds.push("nutrition");
  input.capabilities.push({ ...input.capabilities[0] });
  const errors = validateCoachFeatureKnowledge(input).join("\n");
  assert.match(errors, /Duplicate catalog id: recurring-meals/);
  assert.match(errors, /Duplicate route ownership: recurring-meals.tsx/);
  assert.match(
    errors,
    /Duplicate feature reference in recurring-meals: nutrition/,
  );
});

test("rejects classifying a user-facing feature as internal as well", () => {
  const input = fixture();
  input.internalFeatures.push({
    id: "nutrition",
    reason: "Incorrect exclusion.",
  });
  assert.match(
    validateCoachFeatureKnowledge(input).join("\n"),
    /both user-facing and internal: nutrition/,
  );
});

test("wildcard routes cannot silently cover future screens", () => {
  const input = fixture();
  input.capabilities[0].routes = ["*.tsx"];
  const errors = validateCoachFeatureKnowledge(input).join("\n");
  assert.match(errors, /Unknown route in recurring-meals: \*\.tsx/);
  assert.match(errors, /no Coach capability owner: recurring-meals.tsx/);
});
