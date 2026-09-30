import { describe, expect, it, vi } from "vitest";
import type { UserId } from "./index";
import {
  canApproveFollowRequest,
  canDeclineFollowRequest,
  canReactToActivity,
  canSendFollowRequest,
  canViewSharedActivity,
  generateAvatarSymbol,
  isAdultEligibleForCommunity,
  isInvitationValid,
  normalizeCommunityHandle,
  toPublicCommunityProfile,
  validateContentSafety,
  redactReportForSubject,
  MAX_REPORTS_PER_DAY,
  type StoredCommunityInvitation,
  type StoredCommunityProfile,
  type StoredCommunityReport,
} from "./community";

const userA = "c0000000-0000-4000-8000-000000000001" as UserId;
const userB = "c0000000-0000-4000-8000-000000000002" as UserId;

describe("normalizeCommunityHandle", () => {
  it("trims whitespace and converts to lowercase", () => {
    expect(normalizeCommunityHandle("  Alex_Runner  ")).toBe("alex_runner");
    expect(normalizeCommunityHandle("ALEX")).toBe("alex");
  });
});

describe("generateAvatarSymbol", () => {
  it("derives initials from two-word names", () => {
    expect(generateAvatarSymbol("Alex Runner")).toBe("AR");
    expect(generateAvatarSymbol("John Doe")).toBe("JD");
  });

  it("derives first two characters from single-word names", () => {
    expect(generateAvatarSymbol("Alex")).toBe("AL");
    expect(generateAvatarSymbol("Z")).toBe("Z");
  });

  it("keeps whole Unicode code points in generated initials", () => {
    expect(generateAvatarSymbol("🏃 Runner")).toBe("🏃R");
    expect(generateAvatarSymbol("🏃🚴 Athlete")).toBe("🏃A");
    expect(generateAvatarSymbol("🏃🚴")).toBe("🏃🚴");
  });

  it("handles fallback for empty names", () => {
    expect(generateAvatarSymbol("")).toBe("MZ");
  });
});

describe("toPublicCommunityProfile", () => {
  it("projects public fields and strips internal generation/status/updatedAt", () => {
    const profile: StoredCommunityProfile = {
      userId: userA,
      handle: "alex_r",
      displayName: "Alex",
      avatarSymbol: "AR",
      bio: "Runner",
      isSearchable: true,
      status: "active",
      generation: 2,
      createdAt: new Date("2026-09-29T10:00:00Z"),
      updatedAt: new Date("2026-09-29T12:00:00Z"),
    };
    const publicProfile = toPublicCommunityProfile(profile);
    expect(publicProfile).toEqual({
      userId: userA,
      handle: "alex_r",
      displayName: "Alex",
      avatarSymbol: "AR",
      bio: "Runner",
      createdAt: new Date("2026-09-29T10:00:00Z"),
    });
    expect(
      (publicProfile as unknown as Record<string, unknown>).generation,
    ).toBeUndefined();
    expect(
      (publicProfile as unknown as Record<string, unknown>).status,
    ).toBeUndefined();
    expect(
      (publicProfile as unknown as Record<string, unknown>).isSearchable,
    ).toBeUndefined();
  });
});

describe("isAdultEligibleForCommunity", () => {
  it("conservatively admits only years at least 19 years earlier", () => {
    expect(isAdultEligibleForCommunity(2000, 2026)).toBe(true);
    expect(isAdultEligibleForCommunity(2007, 2026)).toBe(true);
    expect(isAdultEligibleForCommunity(2008, 2026)).toBe(false);
  });

  it("uses UTC at the year boundary", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
      expect(isAdultEligibleForCommunity(2008)).toBe(false);
      vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
      expect(isAdultEligibleForCommunity(2008)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects minors under 18", () => {
    expect(isAdultEligibleForCommunity(2009, 2026)).toBe(false);
    expect(isAdultEligibleForCommunity(2015, 2026)).toBe(false);
  });

  it("fails closed on missing or invalid birth year", () => {
    expect(isAdultEligibleForCommunity(null, 2026)).toBe(false);
    expect(isAdultEligibleForCommunity(undefined, 2026)).toBe(false);
    expect(isAdultEligibleForCommunity(Number.NaN, 2026)).toBe(false);
    for (const invalid of [-Infinity, Infinity, -1, 2000.5, 1800, 2027]) {
      expect(isAdultEligibleForCommunity(invalid, 2026)).toBe(false);
    }
  });
});

describe("canSendFollowRequest", () => {
  it("allows follow request when not connected or blocked", () => {
    expect(
      canSendFollowRequest({
        followerUserId: userA,
        targetUserId: userB,
        existingStatus: null,
        isBlocked: false,
      }),
    ).toBe(true);

    expect(
      canSendFollowRequest({
        followerUserId: userA,
        targetUserId: userB,
        existingStatus: "declined",
        isBlocked: false,
      }),
    ).toBe(true);
  });

  it("prohibits self-following", () => {
    expect(
      canSendFollowRequest({
        followerUserId: userA,
        targetUserId: userA,
        existingStatus: null,
        isBlocked: false,
      }),
    ).toBe(false);
  });

  it("prohibits follow request when blocked in either direction", () => {
    expect(
      canSendFollowRequest({
        followerUserId: userA,
        targetUserId: userB,
        existingStatus: null,
        isBlocked: true,
      }),
    ).toBe(false);
  });

  it("prohibits duplicate pending or already approved requests", () => {
    expect(
      canSendFollowRequest({
        followerUserId: userA,
        targetUserId: userB,
        existingStatus: "pending",
        isBlocked: false,
      }),
    ).toBe(false);

    expect(
      canSendFollowRequest({
        followerUserId: userA,
        targetUserId: userB,
        existingStatus: "approved",
        isBlocked: false,
      }),
    ).toBe(false);
  });
});

describe("canApproveFollowRequest and canDeclineFollowRequest", () => {
  it("allows target user to approve pending request", () => {
    expect(
      canApproveFollowRequest({
        existingStatus: "pending",
        actorUserId: userB,
        targetUserId: userB,
        isBlocked: false,
      }),
    ).toBe(true);
  });

  it("prevents requester from forging approval", () => {
    expect(
      canApproveFollowRequest({
        existingStatus: "pending",
        actorUserId: userA, // Requester, not target!
        targetUserId: userB,
        isBlocked: false,
      }),
    ).toBe(false);
  });

  it("prevents approval if blocked", () => {
    expect(
      canApproveFollowRequest({
        existingStatus: "pending",
        actorUserId: userB,
        targetUserId: userB,
        isBlocked: true,
      }),
    ).toBe(false);
  });

  it("allows target user to decline pending request", () => {
    expect(
      canDeclineFollowRequest({
        existingStatus: "pending",
        actorUserId: userB,
        targetUserId: userB,
      }),
    ).toBe(true);
  });
});

describe("canViewSharedActivity", () => {
  it("allows author to view their own active card", () => {
    expect(
      canViewSharedActivity({
        viewerUserId: userA,
        authorUserId: userA,
        isBlocked: false,
        relationshipStatus: null,
        isRevoked: false,
        authorStatus: "active",
      }),
    ).toBe(true);
  });

  it("allows approved follower to view card", () => {
    expect(
      canViewSharedActivity({
        viewerUserId: userB,
        authorUserId: userA,
        isBlocked: false,
        relationshipStatus: "approved",
        isRevoked: false,
        authorStatus: "active",
      }),
    ).toBe(true);
  });

  it("denies access to non-followers or pending followers", () => {
    expect(
      canViewSharedActivity({
        viewerUserId: userB,
        authorUserId: userA,
        isBlocked: false,
        relationshipStatus: "pending",
        isRevoked: false,
        authorStatus: "active",
      }),
    ).toBe(false);

    expect(
      canViewSharedActivity({
        viewerUserId: userB,
        authorUserId: userA,
        isBlocked: false,
        relationshipStatus: null,
        isRevoked: false,
        authorStatus: "active",
      }),
    ).toBe(false);
  });

  it("denies access if blocked in either direction", () => {
    expect(
      canViewSharedActivity({
        viewerUserId: userB,
        authorUserId: userA,
        isBlocked: true,
        relationshipStatus: "approved",
        isRevoked: false,
        authorStatus: "active",
      }),
    ).toBe(false);
  });

  it("denies access if card is revoked", () => {
    expect(
      canViewSharedActivity({
        viewerUserId: userB,
        authorUserId: userA,
        isBlocked: false,
        relationshipStatus: "approved",
        isRevoked: true,
        authorStatus: "active",
      }),
    ).toBe(false);
  });

  it("denies access if author profile is not active (withdrawn or suspended)", () => {
    expect(
      canViewSharedActivity({
        viewerUserId: userB,
        authorUserId: userA,
        isBlocked: false,
        relationshipStatus: "approved",
        isRevoked: false,
        authorStatus: "withdrawn",
      }),
    ).toBe(false);
  });
});

describe("canReactToActivity", () => {
  it("allows reaction only if user can view, card is not revoked, and user is not author", () => {
    expect(canReactToActivity({ canView: true, cardIsRevoked: false })).toBe(
      true,
    );
    expect(
      canReactToActivity({
        canView: true,
        cardIsRevoked: false,
        isAuthor: false,
      }),
    ).toBe(true);
    expect(
      canReactToActivity({
        canView: true,
        cardIsRevoked: false,
        isAuthor: true,
      }),
    ).toBe(false);
    expect(canReactToActivity({ canView: false, cardIsRevoked: false })).toBe(
      false,
    );
    expect(canReactToActivity({ canView: true, cardIsRevoked: true })).toBe(
      false,
    );
  });
});

describe("isInvitationValid", () => {
  const baseInvite: StoredCommunityInvitation = {
    id: "inv-1",
    token: "valid-token-12345",
    inviterUserId: "u1" as UserId,
    expiresAt: new Date("2026-10-06T12:00:00Z"),
    revokedAt: null,
    createdAt: new Date("2026-09-29T12:00:00Z"),
  };

  it("returns true for unexpired, unrevoked invitation", () => {
    expect(
      isInvitationValid(baseInvite, new Date("2026-09-30T12:00:00Z")),
    ).toBe(true);
  });

  it("returns false for revoked invitation", () => {
    const revoked = {
      ...baseInvite,
      revokedAt: new Date("2026-09-30T10:00:00Z"),
    };
    expect(isInvitationValid(revoked, new Date("2026-09-30T12:00:00Z"))).toBe(
      false,
    );
  });

  it("returns false for expired invitation", () => {
    expect(
      isInvitationValid(baseInvite, new Date("2026-10-07T12:00:00Z")),
    ).toBe(false);
  });
});

describe("validateContentSafety", () => {
  it("allows safe text and empty text", () => {
    expect(validateContentSafety("Completed a great 5k run today!").ok).toBe(
      true,
    );
    expect(validateContentSafety("").ok).toBe(true);
    expect(validateContentSafety(null).ok).toBe(true);
  });

  it("detects severe harassment / threats", () => {
    const res = validateContentSafety("You should go kill yourself now");
    expect(res.ok).toBe(false);
    expect(res.violationCategory).toBe("harassment");
  });

  it("detects body shaming and pro-eating disorder content", () => {
    const res1 = validateContentSafety("Check out these thinspo tips");
    expect(res1.ok).toBe(false);
    expect(res1.violationCategory).toBe("body_shaming");

    const res2 = validateContentSafety("You are a fat pig");
    expect(res2.ok).toBe(false);
    expect(res2.violationCategory).toBe("body_shaming");
  });

  it("detects dangerous fitness advice and extreme dehydration", () => {
    const res = validateContentSafety(
      "Do a dry fast for 5 days to cut weight fast",
    );
    expect(res.ok).toBe(false);
    expect(res.violationCategory).toBe("dangerous_fitness");
  });

  it("detects scams and commercial spam patterns", () => {
    const res = validateContentSafety("Buy followers cheap at our link");
    expect(res.ok).toBe(false);
    expect(res.violationCategory).toBe("scam_spam");
  });

  it("detects impersonation of Mizyun officials", () => {
    const res = validateContentSafety("Message official Mizyun support here");
    expect(res.ok).toBe(false);
    expect(res.violationCategory).toBe("impersonation");
  });

  it("detects prohibited sexual content / CSAE", () => {
    const res = validateContentSafety("prohibited csam link");
    expect(res.ok).toBe(false);
    expect(res.violationCategory).toBe("sexual_content");
  });
});

describe("redactReportForSubject", () => {
  it("redacts reporterUserId and staffNotes when exposing report summary to subject", () => {
    const report: StoredCommunityReport = {
      id: "rep-1",
      reporterUserId: userA,
      targetType: "activity",
      targetId: "act-1",
      reason: "harassment",
      notes: "Private reporter notes detailing encounter",
      status: "resolved",
      priority: "normal",
      assignedTo: "staff-1",
      decision: "remove",
      decisionReason: "Policy violation",
      staffNotes: "Internal operator notes - highly confidential",
      actionTakenAt: new Date("2026-09-30T10:00:00Z"),
      createdAt: new Date("2026-09-30T09:00:00Z"),
      updatedAt: new Date("2026-09-30T10:00:00Z"),
    };

    const redacted = redactReportForSubject(report);
    expect(redacted.id).toBe("rep-1");
    expect(redacted.targetId).toBe("act-1");
    expect(redacted.status).toBe("resolved");
    const record = redacted as unknown as Record<string, unknown>;
    expect(record.reporterUserId).toBeUndefined();
    expect(record.notes).toBeUndefined();
    expect(record.staffNotes).toBeUndefined();
    expect(record.assignedTo).toBeUndefined();
  });

  it("enforces MAX_REPORTS_PER_DAY = 10", () => {
    expect(MAX_REPORTS_PER_DAY).toBe(10);
  });
});
