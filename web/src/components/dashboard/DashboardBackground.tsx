"use client";

import Image from "next/image";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import dashboardBackground from "../../../public/assets/dashboard.jpg";

export type DashboardTheme = "painting" | "dark";
const STORAGE_KEY = "olio.dashboard.theme";

const DashboardThemeContext = createContext<{
  theme: DashboardTheme;
  // The theme the person picked, or null while they rely on the default.
  preference: DashboardTheme | null;
  setTheme: (theme: DashboardTheme) => void;
  toggleTheme: () => void;
}>({
  theme: "painting",
  preference: null,
  setTheme: () => {},
  toggleTheme: () => {},
});

export function useDashboardTheme() {
  return useContext(DashboardThemeContext);
}

export function DashboardBackground({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<DashboardTheme | null>(null);
  const theme = preference ?? "painting";

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "painting") setPreference(stored);
  }, []);

  // Dialogs portal into <body>, outside the wrapper below, so mirror the
  // theme onto <html> for the [data-dashboard-theme] rules to reach them.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.dashboardTheme = theme;
    return () => {
      delete root.dataset.dashboardTheme;
    };
  }, [theme]);

  const value = useMemo(() => {
    const setTheme = (next: DashboardTheme) => {
      window.localStorage.setItem(STORAGE_KEY, next);
      setPreference(next);
    };
    return {
      theme,
      preference,
      setTheme,
      toggleTheme: () => setTheme(theme === "painting" ? "dark" : "painting"),
    };
  }, [theme, preference]);

  return (
    <DashboardThemeContext.Provider value={value}>
      <div
        className="theme-product relative isolate min-h-svh overflow-x-clip bg-brand-obsidian text-white"
        data-dashboard-theme={theme}
      >
        <div
          className="pointer-events-none fixed inset-0 z-0"
          aria-hidden="true"
        >
          <Image
            src={dashboardBackground}
            alt=""
            fill
            priority
            placeholder="blur"
            sizes="100vw"
            className="object-cover object-center"
          />
          <div
            className={`absolute inset-0 bg-brand-obsidian transition-opacity duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${
              theme === "painting" ? "opacity-30" : "opacity-75"
            }`}
          />
          {theme === "painting" ? (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,transparent_0%,rgb(26_31_18_/_0.08)_54%,rgb(26_31_18_/_0.34)_100%)]" />
          ) : null}
        </div>
        <div className="relative z-10 min-h-svh">{children}</div>
      </div>
    </DashboardThemeContext.Provider>
  );
}
