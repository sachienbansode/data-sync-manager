const IST = "Asia/Kolkata";

function getParts(iso: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone: IST, ...opts }).formatToParts(new Date(iso));
  } catch {
    return [];
  }
}

function get(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** dd-MMM-yyyy in IST (e.g. 12-May-2026) */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const p = getParts(iso, { day: "2-digit", month: "short", year: "numeric" });
    return `${get(p, "day")}-${get(p, "month")}-${get(p, "year")}`;
  } catch {
    return "—";
  }
}

/** dd-MMM-yyyy HH:mm in IST (e.g. 12-May-2026 14:30) */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const p = getParts(iso, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    return `${get(p, "day")}-${get(p, "month")}-${get(p, "year")} ${get(p, "hour")}:${get(p, "minute")}`;
  } catch {
    return "—";
  }
}

/** dd-MMM-yyyy HH:mm:ss in IST (e.g. 12-May-2026 14:30:05) */
export function formatDateTimeSec(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const p = getParts(iso, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    return `${get(p, "day")}-${get(p, "month")}-${get(p, "year")} ${get(p, "hour")}:${get(p, "minute")}:${get(p, "second")}`;
  } catch {
    return "—";
  }
}
