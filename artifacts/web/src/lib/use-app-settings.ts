import { useQuery } from "@tanstack/react-query";

interface AppSettings {
  id: number;
  appName: string;
  hasLogo: boolean;
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

export function getLogoUrl(): string {
  return `${import.meta.env.BASE_URL}api/admin/app-settings/logo`;
}
