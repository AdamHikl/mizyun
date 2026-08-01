import { IdentityError } from "@mizyun/identity";

export type AuthAction = "forgot" | "sign-in" | "sign-up";

/**
 * Authentication providers may attach response bodies, URLs, status text, or
 * other implementation details to their exceptions. Keep those details at the
 * adapter boundary and expose only stable, actionable copy in the mobile UI.
 */
export const authErrorMessage = (
  action: AuthAction,
  error: unknown,
): string => {
  if (error instanceof IdentityError && error.code === "AUTH_NOT_CONFIGURED") {
    return "Authentication is not available in this build.";
  }

  switch (action) {
    case "sign-in":
      return "We couldn't sign you in. Check your email and password, then try again.";
    case "sign-up":
      return "We couldn't finish creating your account. Please try again in a moment.";
    case "forgot":
      return "We couldn't send a reset link. Check your connection and try again.";
  }
};
