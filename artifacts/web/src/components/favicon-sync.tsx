import { useEffect } from "react";
import { useAppSettings, getLogoUrl } from "@/lib/use-app-settings";

export function FaviconSync() {
  const { data: appCfg } = useAppSettings();

  useEffect(() => {
    const link: HTMLLinkElement =
      (document.querySelector("link[rel~='icon']") as HTMLLinkElement) ||
      (() => {
        const el = document.createElement("link");
        el.rel = "icon";
        document.head.appendChild(el);
        return el;
      })();

    if (appCfg?.hasLogo) {
      link.href = `${getLogoUrl()}?t=${Date.now()}`;
      link.type = "image/png";
    }
  }, [appCfg?.hasLogo, appCfg?.updatedAt]);

  return null;
}
