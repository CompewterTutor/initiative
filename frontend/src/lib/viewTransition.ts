import { flushSync } from "react-dom";

/**
 * Run an action inside a CSS View Transitions snapshot.
 *
 * Browsers that support the API (Chromium 111+, Safari 18+, Firefox 138+)
 * capture the DOM before and after `action`, then interpolate between the two:
 * elements that share a `view-transition-name` morph between their old and new
 * layout positions; everything else crossfades. Browsers without support, and
 * users with `prefers-reduced-motion: reduce`, simply run the action.
 *
 * The action runs inside `flushSync` so any React state updates it makes
 * (including `queryClient.setQueryData` calls that propagate through
 * `useSyncExternalStore`) commit to the DOM before this function returns —
 * the View Transitions API would otherwise capture the post-snapshot with the
 * pre-mutation DOM and animate from old → old, which looks identical to no
 * animation at all plus a quarter-second of perceived stall.
 */
export const withViewTransition = (action: () => void): void => {
  if (typeof document === "undefined" || typeof document.startViewTransition !== "function") {
    action();
    return;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    action();
    return;
  }
  document.startViewTransition(() => {
    flushSync(action);
  });
};
