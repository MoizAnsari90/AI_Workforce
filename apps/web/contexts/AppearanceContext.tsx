"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, normalizeAppearance, resolveTheme, type Appearance } from "@/lib/appearance";

type AppearanceContextValue = {
  preferences: Appearance;
  resolvedTheme: "light" | "dark";
  mounted: boolean;
  update: (patch: Partial<Appearance>) => void;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [resolved, setResolved] = useState<"light" | "dark">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const read = (value: string | null) => {
      try { setPreferences(normalizeAppearance(JSON.parse(value || "null"))); }
      catch { setPreferences(DEFAULT_APPEARANCE); }
    };
    try { read(localStorage.getItem(APPEARANCE_KEY)); } catch { /* Storage can be unavailable; in-memory settings still work. */ }
    setMounted(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_KEY || event.key === null) read(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = resolveTheme(preferences.theme, media.matches);
      const element = document.documentElement;
      element.dataset.theme = theme;
      element.dataset.palette = preferences.palette;
      element.dataset.contrast = preferences.contrast;
      element.classList.toggle("dark", theme === "dark");
      element.style.colorScheme = theme;
      setResolved(theme);
    };
    apply();
    media.addEventListener("change", apply);
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(preferences)); } catch { /* Keep the current session usable. */ }
    return () => media.removeEventListener("change", apply);
  }, [preferences, mounted]);

  const update = useCallback((patch: Partial<Appearance>) => {
    setPreferences(current => normalizeAppearance({ ...current, ...patch }));
  }, []);

  return <AppearanceContext.Provider value={{ preferences, resolvedTheme: resolved, mounted, update }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("AppearanceProvider is required");
  return context;
}
