/**
 * Counter-specific color helpers: a palette of muted hues for new counters,
 * plus a contrast-text-color picker so the card text stays legible whatever
 * color the counter is set to.
 *
 * Colors are deliberately desaturated mid-tones (not the vivid Tailwind-500
 * set) so a grid full of counters reads as calm rather than neon. ~30 hues
 * spanning the wheel keep randomly-assigned colors visually distinct.
 */

export const COUNTER_COLOR_PALETTE = [
  // reds / roses
  "#C25B5B",
  "#B5746B",
  "#C77B7B",
  // oranges
  "#C2855B",
  "#BC8A5F",
  "#CC8E63",
  // ambers / yellows
  "#C2A35B",
  "#B8A55C",
  "#C7B86A",
  // limes / greens
  "#9DB063",
  "#84A35C",
  "#6FA06B",
  "#5FA07E",
  // teals / cyans
  "#5B9E9E",
  "#5F97A0",
  "#6B8F9E",
  // blues
  "#5B7FC2",
  "#6B82B5",
  "#7088B0",
  // indigos / violets
  "#6F6FB0",
  "#7B6BB5",
  "#8A6FB0",
  // purples / orchids
  "#9E6BA0",
  "#A86B97",
  "#B06B8A",
  // pinks
  "#C25B86",
  "#B57088",
  // warm / cool neutrals
  "#8A7B6B",
  "#9E8F7E",
  "#7E8579",
];

export const pickRandomCounterColor = (): string =>
  COUNTER_COLOR_PALETTE[Math.floor(Math.random() * COUNTER_COLOR_PALETTE.length)] ??
  COUNTER_COLOR_PALETTE[0]!;

/**
 * Return a foreground text color (near-black or white) that has good contrast
 * against the given background. Uses YIQ luminance — fast, no library, gives
 * the same answer humans pick for most palette colors.
 *
 * Accepts hex strings: ``#RGB``, ``#RRGGBB``, ``#RRGGBBAA`` (alpha ignored).
 * Returns ``undefined`` for unparseable input so the caller can fall back.
 */
export const getContrastingTextColor = (
  background: string | null | undefined
): "#0F172A" | "#FFFFFF" | undefined => {
  if (!background) return undefined;
  let hex = background.startsWith("#") ? background.slice(1) : background;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (hex.length !== 6 && hex.length !== 8) return undefined;

  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return undefined;

  // YIQ luminance — values >= ~128 are "light".
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? "#0F172A" : "#FFFFFF";
};
