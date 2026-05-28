import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { PASSWORD_MIN_LENGTH, validatePasswordLocal } from "./passwordPolicy";

// Minimal ``t`` stand-in: returns the key so we can assert on the
// translation lookup without booting i18next.
const fakeT = ((key: string) => key) as unknown as TFunction;

describe("validatePasswordLocal", () => {
  it("returns null for the empty string so we don't shout before typing", () => {
    expect(validatePasswordLocal("", fakeT)).toBeNull();
  });

  it("flags a password one character shorter than the minimum", () => {
    const password = "a".repeat(PASSWORD_MIN_LENGTH - 1);
    expect(validatePasswordLocal(password, fakeT)).toBe("auth:passwordPolicy.minLength");
  });

  it("accepts a password at exactly the minimum length", () => {
    const password = "a".repeat(PASSWORD_MIN_LENGTH);
    expect(validatePasswordLocal(password, fakeT)).toBeNull();
  });

  it("accepts a long password regardless of character classes", () => {
    // Mirror of the NIST 800-63B stance: no class requirements client-side.
    expect(validatePasswordLocal("correct-horse-battery-staple", fakeT)).toBeNull();
    expect(validatePasswordLocal("all-lowercase-passphrase", fakeT)).toBeNull();
  });
});
