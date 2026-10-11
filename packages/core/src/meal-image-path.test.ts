import { describe, expect, it } from "vitest";
import { isOwnedMealImagePath } from "./meal-image-path.js";
const owner = "00000000-0000-4000-8000-000000000001";
const file = "00000000-0000-4000-8000-000000000002.jpg";
describe("privileged owner meal image coordinates", () => {
  it("accepts generated paths and safe existing ASCII filenames", () => {
    expect(
      isOwnedMealImagePath(owner, "private-media", `${owner}/${file}`),
    ).toBe(true);
    expect(
      isOwnedMealImagePath(owner, "private-media", `${owner}/custom-food.jpg`),
    ).toBe(true);
    expect(
      isOwnedMealImagePath(
        owner,
        "private-media",
        `${owner}/meal-photos/${file}`,
      ),
    ).toBe(true);
  });
  it("rejects untrusted coordinate normalization and alternate ownership", () => {
    for (const suffix of [
      `../peer/${file}`,
      `%2e%2e/peer/${file}`,
      `%252e%252e/peer/${file}`,
      `meal-photos/../${file}`,
      `meal-photos%2f${file}`,
      `meal-photos\\${file}`,
      `${file}?token=x`,
      `${file}#fragment`,
      `${file}\n`,
      `.hidden.jpg`,
    ]) {
      expect(
        isOwnedMealImagePath(owner, "private-media", `${owner}/${suffix}`),
      ).toBe(false);
    }
    expect(isOwnedMealImagePath(owner, "public", `${owner}/${file}`)).toBe(
      false,
    );
    expect(isOwnedMealImagePath(owner, "private-media", `peer/${file}`)).toBe(
      false,
    );
  });
});
