import { generateAvatarSymbol } from "@mizyun/core";
import {
  COMMUNITY_TERMS_VERSION,
  createCommunityProfileSchema,
  updateCommunityProfileSchema,
  type CommunityProfileDto,
} from "@mizyun/contracts";

/** Admission remains closed until verified contact/legal/pilot acceptance. */
export const COMMUNITY_ENROLLMENT_OPEN = false;
export const COMMUNITY_RULES_VERSION = COMMUNITY_TERMS_VERSION;

export interface CommunityProfileForm {
  handle: string;
  displayName: string;
  avatarSymbol: string;
  bio: string;
  isSearchable: boolean;
  adultDeclaration: boolean;
  acceptedTerms: boolean;
}

/** Never accepts the private account profile as a source for social identity. */
export function communityProfileForm(
  ownProfile: CommunityProfileDto | null,
): CommunityProfileForm {
  const editing = ownProfile?.status === "active";
  return {
    handle: ownProfile?.handle ?? "",
    displayName: editing ? ownProfile.displayName : "",
    avatarSymbol: editing ? ownProfile.avatarSymbol : "",
    bio: editing ? (ownProfile.bio ?? "") : "",
    isSearchable: editing ? ownProfile.isSearchable : false,
    adultDeclaration: false,
    acceptedTerms: false,
  };
}

export function validateCommunityEnrollment(form: CommunityProfileForm) {
  return createCommunityProfileSchema.safeParse({
    handle: form.handle.trim().toLowerCase(),
    displayName: form.displayName.trim(),
    avatarSymbol:
      form.avatarSymbol.trim() || generateAvatarSymbol(form.displayName),
    bio: form.bio.trim() || null,
    isSearchable: form.isSearchable,
    adultDeclaration: form.adultDeclaration,
    acceptedTerms: form.acceptedTerms,
    termsVersion: COMMUNITY_RULES_VERSION,
  });
}

export function validateCommunityProfileUpdate(form: CommunityProfileForm) {
  return updateCommunityProfileSchema.safeParse({
    displayName: form.displayName.trim(),
    avatarSymbol:
      form.avatarSymbol.trim() || generateAvatarSymbol(form.displayName),
    bio: form.bio.trim() || null,
    isSearchable: form.isSearchable,
  });
}
