import { MINIMUM_USER_AGE_YEARS } from "@mizyun/contracts";

/**
 * Mizyun is for adults 18 and over (PRIV-02). Only a birth year is kept, so
 * for the one year in which a user may be 17 or 18 the app asks whether they
 * have turned 18. That answer is checked on the device and never stored
 * (data minimisation over a full birth date; see the DPIA draft). Callers
 * pass the UTC year so the device agrees with the server's schema.
 */
export const ADULTS_ONLY_MESSAGE =
  "Mizyun is for adults 18 and over, so we can't set this up for you. Nothing you entered has been saved.";

export const TURNED_18_QUESTION = "Have you turned 18 yet?";

export type AdultBirthYearCheck =
  | { readonly kind: "ok"; readonly birthYear: number }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "underage"; readonly message: string }
  | { readonly kind: "ask_turned_18"; readonly message: string };

export const parseBirthYear = (raw: string): number => Number(raw.trim());

const latestAdultYear = (currentYear: number): number =>
  currentYear - MINIMUM_USER_AGE_YEARS;

/** True when `raw` is the one birth year whose holder may still be 17. */
export const needsTurned18Answer = (
  raw: string,
  currentYear: number,
): boolean => parseBirthYear(raw) === latestAdultYear(currentYear);

export const checkAdultBirthYear = (
  raw: string,
  turned18: boolean | null,
  currentYear: number,
): AdultBirthYearCheck => {
  const birthYear = parseBirthYear(raw);
  const latest = latestAdultYear(currentYear);
  if (
    !Number.isInteger(birthYear) ||
    birthYear < 1900 ||
    birthYear > currentYear
  ) {
    return {
      kind: "invalid",
      message: `Enter a birth year between 1900 and ${latest}.`,
    };
  }
  if (birthYear > latest) {
    return { kind: "underage", message: ADULTS_ONLY_MESSAGE };
  }
  if (birthYear === latest) {
    if (turned18 === false) {
      return { kind: "underage", message: ADULTS_ONLY_MESSAGE };
    }
    if (turned18 === null) {
      return {
        kind: "ask_turned_18",
        message: `Born in ${latest}? ${TURNED_18_QUESTION}`,
      };
    }
  }
  return { kind: "ok", birthYear };
};

/** True for a stored birth year that belongs to someone under 18 this year. */
export const storedBirthYearIsUnderage = (
  birthYear: number | null | undefined,
  currentYear: number,
): boolean =>
  typeof birthYear === "number" && birthYear > latestAdultYear(currentYear);
