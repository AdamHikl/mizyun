import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  StyleSheet: {
    create: (styles: unknown) => styles,
  },
  Text: "Text",
  View: "View",
}));

import {
  AVATAR_PALETTES,
  getAvatarColor,
  InitialsAvatar,
} from "./initials-avatar";

describe("InitialsAvatar", () => {
  describe("getAvatarColor", () => {
    it("returns deterministic color palette for a seed", () => {
      const color1 = getAvatarColor("user-123");
      const color2 = getAvatarColor("user-123");
      expect(color1).toEqual(color2);
      expect(AVATAR_PALETTES).toContainEqual(color1);
    });

    it("handles empty or special string seeds", () => {
      const color = getAvatarColor("");
      expect(AVATAR_PALETTES).toContainEqual(color);
    });
  });

  describe("InitialsAvatar component", () => {
    it("renders avatar view with circular radius and deterministic background", () => {
      const element = InitialsAvatar({
        symbol: "DR",
        size: 48,
        seed: "dan_runner",
      });
      expect(element).not.toBeNull();
      expect(element.type).toBe("View");
      expect(element.props.testID).toBe("initials-avatar");
      expect(element.props.accessibilityRole).toBe("image");
      expect(element.props.accessibilityLabel).toBe("Avatar DR");

      const flatStyle = Object.assign({}, ...element.props.style);
      expect(flatStyle.width).toBe(48);
      expect(flatStyle.height).toBe(48);
      expect(flatStyle.borderRadius).toBe(24);
      expect(flatStyle.backgroundColor).toBe(getAvatarColor("dan_runner").bg);
    });

    it("uppercases and truncates symbol to the 4-character contract limit", () => {
      const element = InitialsAvatar({ symbol: "longsymbol" });
      expect(element.props.children.props.children).toBe("LONG");
    });

    it("falls back to ? when symbol is empty", () => {
      const element = InitialsAvatar({ symbol: "" });
      expect(element.props.children.props.children).toBe("?");
    });

    it("respects custom accessibilityLabel when provided", () => {
      const element = InitialsAvatar({
        symbol: "MK",
        accessibilityLabel: "Marcus's avatar",
      });
      expect(element.props.accessibilityLabel).toBe("Marcus's avatar");
    });
  });
});
