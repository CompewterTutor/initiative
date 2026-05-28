import { describe, expect, it } from "vitest";

import { obfuscateEmail } from "./obfuscateEmail";

describe("obfuscateEmail", () => {
  it("masks the canonical case from the spec", () => {
    expect(obfuscateEmail("alice@gmail.com")).toBe("a***@g***m");
  });

  it("masks short local + short tld", () => {
    expect(obfuscateEmail("a@b.co")).toBe("a***@b***o");
  });

  it("collapses multi-part domains into first/last only", () => {
    expect(obfuscateEmail("foo@mail.example.com")).toBe("f***@m***m");
  });

  it("preserves a single-character local part", () => {
    expect(obfuscateEmail("x@example.com")).toBe("x***@e***m");
  });

  it("handles a single-character domain by repeating it as first+last", () => {
    expect(obfuscateEmail("alice@x")).toBe("a***@x***");
  });

  it("is case-insensitive in what it returns: it preserves input casing", () => {
    expect(obfuscateEmail("Alice@Example.COM")).toBe("A***@E***M");
  });

  it("trims surrounding whitespace before masking", () => {
    expect(obfuscateEmail("  alice@gmail.com  ")).toBe("a***@g***m");
  });

  it("returns the input unchanged when there's no @", () => {
    expect(obfuscateEmail("not-an-email")).toBe("not-an-email");
  });

  it("returns the input unchanged when @ is at the start or end", () => {
    expect(obfuscateEmail("@example.com")).toBe("@example.com");
    expect(obfuscateEmail("alice@")).toBe("alice@");
  });

  it("returns an empty string for nullish / empty input", () => {
    expect(obfuscateEmail(null)).toBe("");
    expect(obfuscateEmail(undefined)).toBe("");
    expect(obfuscateEmail("")).toBe("");
    expect(obfuscateEmail("   ")).toBe(""); // whitespace-only collapses to "" after trim
  });
});
