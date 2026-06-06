import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getItem, setItem } from "@/lib/storage";

/**
 * `auto` enables Pride styling during Pride Month (June), `on`/`off` force it.
 */
export type PridePreference = "auto" | "on" | "off";

interface PrideContextValue {
  /** The stored user preference. */
  preference: PridePreference;
  /** Whether Pride styling is currently active (resolves `auto` against the date). */
  enabled: boolean;
  setPreference: (preference: PridePreference) => void;
}

const PrideContext = createContext<PrideContextValue | undefined>(undefined);

const PRIDE_STORAGE_KEY = "initiative-pride";

/** June (month index 5) is Pride Month. */
const isPrideMonth = (date: Date): boolean => date.getMonth() === 5;

const getStoredPreference = (): PridePreference => {
  const stored = getItem(PRIDE_STORAGE_KEY);
  if (stored === "auto" || stored === "on" || stored === "off") {
    return stored;
  }
  return "auto";
};

const resolveEnabled = (preference: PridePreference): boolean => {
  switch (preference) {
    case "on":
      return true;
    case "off":
      return false;
    default:
      // `auto`: live during June. Computed on mount / preference change — the
      // rare June→July boundary crossing while the app stays open is settled
      // by the next reload.
      return isPrideMonth(new Date());
  }
};

const applyPrideClass = (enabled: boolean) => {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("pride", enabled);
};

export const PrideProvider = ({ children }: { children: React.ReactNode }) => {
  const [preference, setPreferenceState] = useState<PridePreference>(() => getStoredPreference());
  const enabled = useMemo(() => resolveEnabled(preference), [preference]);

  useEffect(() => {
    applyPrideClass(enabled);
  }, [enabled]);

  useEffect(() => {
    setItem(PRIDE_STORAGE_KEY, preference);
  }, [preference]);

  const setPreference = useCallback((next: PridePreference) => {
    setPreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({ preference, enabled, setPreference }),
    [preference, enabled, setPreference]
  );

  return <PrideContext.Provider value={value}>{children}</PrideContext.Provider>;
};

/**
 * Read the active Pride state. Falls back to a disabled default when no
 * provider is mounted so the (widely embedded, purely cosmetic) `LogoIcon`
 * never crashes an isolated render or test — unlike the throw-on-missing
 * convention of the data hooks.
 */
export const usePride = (): PrideContextValue => {
  return (
    useContext(PrideContext) ?? {
      preference: "auto",
      enabled: false,
      setPreference: () => {},
    }
  );
};
