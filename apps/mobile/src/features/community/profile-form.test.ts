import { describe, expect, it } from "vitest";
import type { CommunityProfileDto } from "@mizyun/contracts";
import {
  COMMUNITY_ENROLLMENT_OPEN,
  communityProfileForm,
  validateCommunityEnrollment,
  validateCommunityProfileUpdate,
} from "./profile-form";

const profile: CommunityProfileDto = {
  userId: "00000000-0000-0000-0000-000000000001",
  handle: "social_name",
  displayName: "Social Name",
  avatarSymbol: "NAME",
  bio: "A social bio",
  isSearchable: true,
  status: "active",
  generation: 1,
  createdAt: "2026-09-30T10:00:00Z",
  updatedAt: "2026-09-30T10:00:00Z",
};

const filled = () => ({
  ...communityProfileForm(null),
  handle: "  RUNNER_1 ",
  displayName: "Social Runner",
  avatarSymbol: "RUN",
  adultDeclaration: true,
  acceptedTerms: true,
});

describe("Community separate enrollment and settings form", () => {
  it("starts with blank social identity and three separate unchecked choices", () => {
    expect(communityProfileForm(null)).toEqual({
      handle: "",
      displayName: "",
      avatarSymbol: "",
      bio: "",
      adultDeclaration: false,
      acceptedTerms: false,
      isSearchable: false,
    });
  });

  it("requires both fresh declaration and current rules while search remains optional", () => {
    const form = filled();
    expect(
      validateCommunityEnrollment({ ...form, adultDeclaration: false }).success,
    ).toBe(false);
    expect(
      validateCommunityEnrollment({ ...form, acceptedTerms: false }).success,
    ).toBe(false);
    const valid = validateCommunityEnrollment(form);
    expect(valid.success).toBe(true);
    if (valid.success)
      expect(valid.data).toMatchObject({
        handle: "runner_1",
        adultDeclaration: true,
        acceptedTerms: true,
        termsVersion: "2026-09-30",
        isSearchable: false,
      });
  });

  it("keeps only the reserved handle on returning, with no restored profile text or consent", () => {
    const form = communityProfileForm({ ...profile, status: "withdrawn" });
    expect(form).toEqual({
      ...communityProfileForm(null),
      handle: "social_name",
    });
    expect(validateCommunityEnrollment(form).success).toBe(false);
    expect(
      validateCommunityEnrollment({ ...filled(), handle: form.handle }).success,
    ).toBe(true);
  });

  it("updates only permitted social fields without renaming handle or recording new enrollment consent", () => {
    const form = {
      ...communityProfileForm(profile),
      handle: "attempted_rename",
    };
    const result = validateCommunityProfileUpdate(form);
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data).toEqual({
        displayName: "Social Name",
        avatarSymbol: "NAME",
        bio: "A social bio",
        isSearchable: true,
      });
  });

  it("rejects blank social names, oversized bios and invalid handles before submission", () => {
    expect(
      validateCommunityEnrollment({ ...filled(), displayName: "   " }).success,
    ).toBe(false);
    expect(
      validateCommunityEnrollment({ ...filled(), bio: "x".repeat(161) })
        .success,
    ).toBe(false);
    expect(
      validateCommunityEnrollment({ ...filled(), handle: "bad handle" })
        .success,
    ).toBe(false);
  });

  it("generates initials from the deliberate social name when omitted", () => {
    const result = validateCommunityEnrollment({
      ...filled(),
      avatarSymbol: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.avatarSymbol).toBe("SR");
    const unicode = validateCommunityEnrollment({
      ...filled(),
      displayName: "🏃 Runner",
      avatarSymbol: "",
    });
    expect(unicode.success).toBe(true);
    if (unicode.success) expect(unicode.data.avatarSymbol).toBe("🏃R");
  });

  it("keeps enrollment unavailable before actual contact and pilot acceptance", () => {
    expect(COMMUNITY_ENROLLMENT_OPEN).toBe(false);
  });
});
