import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface AppSettings {
  id: number;
  appName: string;
  hasLogo: boolean;
  fontFamily: string;
  menuFontSize: string;
  bodyFontSize: string;
  headingFontSize: string;
  updatedAt: string;
}

async function fetchAppSettings(): Promise<AppSettings> {
  const resp = await fetch(`${import.meta.env.BASE_URL}api/admin/app-settings`);
  if (!resp.ok) throw new Error("Failed to load app settings");
  return resp.json();
}

export function useAppSettings() {
  return useQuery<AppSettings>({
    queryKey: ["app-settings"],
    queryFn: fetchAppSettings,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

const SYSTEM_FONTS = new Set([
  "Arial", "Helvetica", "Trebuchet MS", "Times New Roman", "Georgia",
]);

function ensureGoogleFont(family: string) {
  if (!family || SYSTEM_FONTS.has(family)) return;
  const id = `gfont-${family.replace(/\s+/g, "-")}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

/** Apply font settings from app config as CSS custom properties on <html> */
export function useFontSettings() {
  const { data } = useAppSettings();
  useEffect(() => {
    if (!data) return;
    const family = data.fontFamily ?? "Inter";
    ensureGoogleFont(family);
    const root = document.documentElement;
    // --font-sans is mapped to --app-font-sans in index.css @theme
    root.style.setProperty("--app-font-sans", `"${family}", sans-serif`);
    root.style.setProperty("--app-font-family", `"${family}", sans-serif`);
    root.style.setProperty("--app-menu-font-size", `${data.menuFontSize ?? 14}px`);
    root.style.setProperty("--app-body-font-size", `${data.bodyFontSize ?? 14}px`);
    root.style.setProperty("--app-heading-font-size", `${data.headingFontSize ?? 24}px`);
    root.style.fontSize = `${data.bodyFontSize ?? 14}px`;
  }, [data]);
}

export function getLogoUrl(): string {
  return `${import.meta.env.BASE_URL}api/admin/app-settings/logo`;
}
