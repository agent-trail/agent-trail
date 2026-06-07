import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

export const THEME_STORAGE_KEY = "agent-trail-theme";
export const THEMES = ["light", "dark", "black"] as const;

export type ThemeName = (typeof THEMES)[number];

type ThemeContextValue = {
  resolvedTheme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  theme: ThemeName;
  themes: readonly ThemeName[];
};

type ThemeRuntime = typeof globalThis & {
  document?: {
    body: { classList: { add: (className: string) => void; remove: (className: string) => void } };
    documentElement: {
      classList: { add: (className: string) => void; remove: (className: string) => void };
      style: { colorScheme: string };
    };
  };
  localStorage?: Pick<Storage, "getItem" | "setItem">;
  matchMedia?: (query: string) => {
    addEventListener: (type: "change", listener: (event: { matches: boolean }) => void) => void;
    matches: boolean;
    removeEventListener: (type: "change", listener: (event: { matches: boolean }) => void) => void;
  };
};

const ThemeContext = createContext<ThemeContextValue>({
  resolvedTheme: "light",
  setTheme: () => undefined,
  theme: "light",
  themes: THEMES,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>("light");

  useEffect(() => {
    const initialTheme = readInitialTheme();
    setThemeState(initialTheme);
    applyTheme(initialTheme);
  }, []);

  useEffect(() => {
    const runtime = globalThis as ThemeRuntime;
    const media = runtime.matchMedia?.("(prefers-color-scheme: dark)");
    if (media === undefined) return;

    const syncSystemTheme = (event: { matches: boolean }) => {
      if (safeGetStoredTheme() !== null) return;
      const nextTheme = event.matches ? "dark" : "light";
      setThemeState(nextTheme);
      applyTheme(nextTheme);
    };

    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      resolvedTheme: theme,
      setTheme: (nextTheme) => {
        safeSetStoredTheme(nextTheme);
        setThemeState(nextTheme);
        applyTheme(nextTheme);
      },
      theme,
      themes: THEMES,
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

function readInitialTheme(): ThemeName {
  const runtime = globalThis as ThemeRuntime;
  const stored = safeGetStoredTheme();
  if (isThemeName(stored)) return stored;
  return runtime.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

function safeGetStoredTheme(): string | null {
  try {
    const runtime = globalThis as ThemeRuntime;
    return runtime.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function safeSetStoredTheme(theme: ThemeName): void {
  try {
    const runtime = globalThis as ThemeRuntime;
    runtime.localStorage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore persistence failures; the active theme still updates in memory and DOM state.
  }
}

function applyTheme(theme: ThemeName) {
  const runtime = globalThis as ThemeRuntime;
  const doc = runtime.document;
  if (doc === undefined) return;

  for (const className of THEMES.map((name) => `${name}-mode`)) {
    doc.documentElement.classList.remove(className);
    doc.body.classList.remove(className);
  }

  doc.documentElement.classList.add(`${theme}-mode`);
  doc.body.classList.add(`${theme}-mode`);
  doc.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
}

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && THEMES.includes(value as ThemeName);
}
