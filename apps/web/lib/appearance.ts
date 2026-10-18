export type Appearance = {
  theme: "light" | "dark" | "system";
  palette: "standard" | "accessible";
  contrast: "standard" | "high";
};

export const APPEARANCE_KEY = "ai-workforce.appearance.v1";
export const DEFAULT_APPEARANCE: Appearance = { theme: "system", palette: "standard", contrast: "standard" };

// Keep self-contained: the same validator runs before hydration in the boot script.
export function normalizeAppearance(value: unknown): Appearance {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    theme: input.theme === "light" || input.theme === "dark" ? input.theme : "system",
    palette: input.palette === "accessible" ? "accessible" : "standard",
    contrast: input.contrast === "high" ? "high" : "standard",
  };
}

export function resolveTheme(theme: Appearance["theme"], systemDark: boolean): "light" | "dark" {
  return theme === "system" ? systemDark ? "dark" : "light" : theme;
}

export const appearanceBootScript = `(()=>{const normalize=${normalizeAppearance.toString()};let value;try{value=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})||"null")}catch{}const p=normalize(value);let dark=true;try{dark=matchMedia("(prefers-color-scheme: dark)").matches}catch{}const theme=p.theme==="system"?(dark?"dark":"light"):p.theme;const r=document.documentElement;r.dataset.theme=theme;r.dataset.palette=p.palette;r.dataset.contrast=p.contrast;r.classList.toggle("dark",theme==="dark");r.style.colorScheme=theme})()`;
