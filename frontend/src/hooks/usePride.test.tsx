import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrideProvider, usePride } from "./usePride";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PrideProvider>{children}</PrideProvider>
);

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.classList.remove("pride");
});

describe("usePride", () => {
  it("auto-enables during June (Pride Month)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    const { result } = renderHook(() => usePride(), { wrapper });

    expect(result.current.preference).toBe("auto");
    expect(result.current.enabled).toBe(true);
    expect(document.documentElement.classList.contains("pride")).toBe(true);
  });

  it("auto stays off outside June", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));

    const { result } = renderHook(() => usePride(), { wrapper });

    expect(result.current.enabled).toBe(false);
    expect(document.documentElement.classList.contains("pride")).toBe(false);
  });

  it("forces on/off regardless of the date and toggles the root class", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z")); // not June

    const { result } = renderHook(() => usePride(), { wrapper });

    act(() => result.current.setPreference("on"));
    expect(result.current.enabled).toBe(true);
    expect(document.documentElement.classList.contains("pride")).toBe(true);

    act(() => result.current.setPreference("off"));
    expect(result.current.enabled).toBe(false);
    expect(document.documentElement.classList.contains("pride")).toBe(false);
  });

  it("persists the preference across mounts", () => {
    const { result, unmount } = renderHook(() => usePride(), { wrapper });
    act(() => result.current.setPreference("on"));
    unmount();

    const { result: remounted } = renderHook(() => usePride(), { wrapper });
    expect(remounted.current.preference).toBe("on");
  });

  it("falls back to a disabled default without a provider", () => {
    const { result } = renderHook(() => usePride());
    expect(result.current.preference).toBe("auto");
    expect(result.current.enabled).toBe(false);
    // setPreference is a safe no-op rather than a crash.
    expect(() => result.current.setPreference("on")).not.toThrow();
  });
});
