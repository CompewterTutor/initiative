import type { TFunction } from "i18next";

/**
 * Password policy — mirror of `backend/app/core/password_policy.py`.
 *
 * Length is the only policy we can validate client-side; the breach
 * check runs server-side (HIBP k-anonymity) on submit and surfaces
 * via the `PASSWORD_BREACHED` error code mapped in `errors.json`.
 *
 * Keep `PASSWORD_MIN_LENGTH` in sync with the backend constant. We
 * don't share it via the OpenAPI schema because the constraint is
 * enforced in the policy module, not at the schema layer (see the
 * comment in the backend module for why).
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Return an i18n'd error message if `password` fails the local part of
 * the policy, or `null` if it passes. Returns `null` for the empty
 * string so we don't show an error before the user has typed
 * anything — surface the requirement as a helper hint instead.
 */
export function validatePasswordLocal(password: string, t: TFunction): string | null {
  if (password.length === 0) {
    return null;
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return t("auth:passwordPolicy.minLength");
  }
  return null;
}
