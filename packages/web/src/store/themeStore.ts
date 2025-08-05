import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme: Theme) => set({ theme }),
    }),
    {
      name: "theme-store",
    }
  )
);

// Helper function to apply theme to document
export const applyTheme = (theme: Theme) => {
  const root = window.document.documentElement;

  // Remove both classes first
  root.classList.remove("light", "dark");

  // Apply appropriate class based on theme
  if (theme === "system") {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    root.classList.add(systemTheme);
  } else {
    root.classList.add(theme);
  }
};
