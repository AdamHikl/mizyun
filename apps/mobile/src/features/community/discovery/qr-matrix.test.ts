import { describe, it, expect } from "vitest";
import { invitationQrMatrix } from "./qr-matrix";
describe("local invitation QR matrix", () => {
  it("encodes each environment's valid capability with an all-white four-module quiet zone", () => {
    for (const scheme of ["mizyun", "mizyun-dev"]) {
      const matrix = invitationQrMatrix(
        `${scheme}://invite/${"A".repeat(22)}`,
      )!;
      expect(matrix.length).toBeGreaterThan(29);
      expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
      expect(matrix.slice(0, 4).flat().some(Boolean)).toBe(false);
      expect(matrix.slice(-4).flat().some(Boolean)).toBe(false);
      expect(
        matrix.every((row) =>
          [...row.slice(0, 4), ...row.slice(-4)].every((dark) => !dark),
        ),
      ).toBe(true);
      // Finder pattern is seven modules wide with a white ring and dark center.
      expect(matrix[4]!.slice(4, 11)).toEqual(Array(7).fill(true));
      expect(matrix[5]!.slice(4, 11)).toEqual([
        true,
        false,
        false,
        false,
        false,
        false,
        true,
      ]);
      expect(matrix[7]!.slice(4, 11)).toEqual([
        true,
        false,
        true,
        true,
        true,
        false,
        true,
      ]);
    }
  });
  it("rejects web URLs and extra query redirects", () => {
    expect(invitationQrMatrix("https://example.com/invite")).toBeNull();
    expect(
      invitationQrMatrix(`mizyun://invite/${"A".repeat(22)}?redirect=evil`),
    ).toBeNull();
  });
});
