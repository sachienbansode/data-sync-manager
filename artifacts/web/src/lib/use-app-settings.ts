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

/** Apply font settings from app config as CSS custom properties on <html> */
export function useFontSettings() {
  const { data } = useAppSettings();
  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    root.style.setProperty("--app-font-family", data.fontFamily ?? "Inter");
    root.style.setProperty("--app-menu-font-size", `${data.menuFontSize ?? 14}px`);
    root.style.setProperty("--app-body-font-size", `${data.bodyFontSize ?? 14}px`);
    root.style.setProperty("--app-heading-font-size", `${data.headingFontSize ?? 24}px`);
    root.style.fontFamily = `${data.fontFamily ?? "Inter"}, sans-serif`;
    root.style.fontSize = `${data.bodyFontSize ?? 14}px`;
  }, [data]);
}

export function getLogoUrl(): string {
  return `${import.meta.env.BASE_URL}api/admin/app-settings/logo`;
}
