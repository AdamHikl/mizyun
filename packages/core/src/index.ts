export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type UserId = Brand<string, "UserId">;
export type ConversationId = Brand<string, "ConversationId">;
export type MemoryId = Brand<string, "MemoryId">;

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({
  ok: false,
  error,
});

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export {
  applyProfilePatch,
  validateProfilePatch,
  HEIGHT_CM_MIN,
  HEIGHT_CM_MAX,
  BIRTH_YEAR_MIN,
  DEFAULT_TIMEZONE,
  DEFAULT_UNIT_SYSTEM,
  DISPLAY_NAME_MAX,
  type ProfileCore,
  type ProfilePatch,
  type ProfileRepository,
  type ProfileValidationError,
  type StoredProfile,
  type UnitSystem,
} from "./profile";
