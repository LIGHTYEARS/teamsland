import { useCallback, useSyncExternalStore } from "react";

type Theme = "auto" | "light" | "dark";

const STORAGE_KEY = "teamsland-theme";

function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {}
  return "auto";
}

function resolveEffective(theme: Theme): "light" | "dark" {
  if (theme !== "auto") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(effective: "light" | "dark") {
  document.documentElement.classList.toggle("dark", effective === "dark");
}

let currentTheme: Theme = getStoredTheme();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Theme {
  return currentTheme;
}

function setTheme(next: Theme) {
  currentTheme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}
  applyTheme(resolveEffective(next));
  for (const cb of listeners) cb();
}

// Initialize on module load
applyTheme(resolveEffective(currentTheme));

// Listen for OS theme changes
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme === "auto") {
      applyTheme(resolveEffective("auto"));
    }
  });
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot);
  const effective = resolveEffective(theme);
  return { theme, effective, setTheme: useCallback(setTheme, []) };
}
