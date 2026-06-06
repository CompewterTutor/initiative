import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrideProvider } from "@/hooks/usePride";

import { LogoIcon } from "./LogoIcon";

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.classList.remove("pride");
});

describe("LogoIcon", () => {
  it("uses the theme primary color outside Pride mode", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z")); // not June

    const { container } = render(
      <PrideProvider>
        <LogoIcon />
      </PrideProvider>
    );

    expect(container.querySelector("linearGradient")).toBeNull();
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
    expect(container.querySelector("svg")?.classList.contains("pride-logo")).toBe(false);
  });

  it("paints the mark with a rainbow gradient in Pride mode", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z")); // June → auto on

    const { container } = render(
      <PrideProvider>
        <LogoIcon />
      </PrideProvider>
    );

    const gradient = container.querySelector("linearGradient");
    expect(gradient).not.toBeNull();
    // All six Pride flag bands are present.
    expect(gradient?.querySelectorAll("stop")).toHaveLength(6);

    const svg = container.querySelector("svg");
    expect(svg?.classList.contains("pride-logo")).toBe(true);

    // Every painted shape references the gradient instead of currentColor.
    const fills = Array.from(container.querySelectorAll("path, ellipse")).map((el) =>
      el.getAttribute("fill")
    );
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect(fill).toMatch(/^url\(#/);
    }
  });
});
