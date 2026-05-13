import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, sql, count } from "drizzle-orm";
import { db, shortUrlsTable, urlClicksTable, shortDomainsTable } from "@workspace/db";
import { authenticate } from "../middlewares/authenticate";

const router: IRouter = Router();

function parseUserAgent(ua: string | undefined): { browser: string; browserVersion: string; os: string; deviceType: string } {
  if (!ua) return { browser: "Unknown", browserVersion: "", os: "Unknown", deviceType: "Unknown" };

  let browser = "Unknown";
  let browserVersion = "";
  let os = "Unknown";
  let deviceType = "Desktop";

  if (/mobile|android|iphone|ipad|ipod|blackberry|windows phone/i.test(ua)) {
    deviceType = /ipad/i.test(ua) ? "Tablet" : "Mobile";
  } else if (/tablet/i.test(ua)) {
    deviceType = "Tablet";
  }

  if (/edg\//i.test(ua)) {
    browser = "Edge";
    browserVersion = ua.match(/edg\/([\d.]+)/i)?.[1] ?? "";
  } else if (/opr\//i.test(ua)) {
    browser = "Opera";
    browserVersion = ua.match(/opr\/([\d.]+)/i)?.[1] ?? "";
  } else if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) {
    browser = "Chrome";
    browserVersion = ua.match(/chrome\/([\d.]+)/i)?.[1] ?? "";
  } else if (/firefox\//i.test(ua)) {
    browser = "Firefox";
    browserVersion = ua.match(/firefox\/([\d.]+)/i)?.[1] ?? "";
  } else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) {
    browser = "Safari";
    browserVersion = ua.match(/version\/([\d.]+)/i)?.[1] ?? "";
  }

  if (/windows nt/i.test(ua)) {
    const ver = ua.match(/windows nt ([\d.]+)/i)?.[1];
    const winMap: Record<string, string> = { "10.0": "Windows 10/11", "6.3": "Windows 8.1", "6.2": "Windows 8", "6.1": "Windows 7" };
    os = winMap[ver ?? ""] ?? "Windows";
  } else if (/mac os x/i.test(ua)) {
    os = "macOS";
  } else if (/android/i.test(ua)) {
    os = `Android ${ua.match(/android ([\d.]+)/i)?.[1] ?? ""}`.trim();
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    os = "iOS";
  } else if (/linux/i.test(ua)) {
    os = "Linux";
  }

  return { browser, browserVersion, os, deviceType };
}

async function getGeoLocation(ip: string): Promise<{ country: string; city: string }> {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168") || ip.startsWith("10.")) {
    return { country: "Local", city: "Local" };
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,status`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { country: "Unknown", city: "Unknown" };
    const data = await res.json() as { status: string; country?: string; city?: string };
    if (data.status === "success") return { country: data.country ?? "Unknown", city: data.city ?? "Unknown" };
  } catch { }
  return { country: "Unknown", city: "Unknown" };
}

function generateCode(length = 7): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function generateUniqueCode(): Promise<string> {
  let code = generateCode();
  let existing = await db.select({ id: shortUrlsTable.id }).from(shortUrlsTable).where(eq(shortUrlsTable.shortCode, code));
  while (existing.length > 0) {
    code = generateCode();
    existing = await db.select({ id: shortUrlsTable.id }).from(shortUrlsTable).where(eq(shortUrlsTable.shortCode, code));
  }
  return code;
}

// GET /short-urls
router.get("/short-urls", authenticate, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: shortUrlsTable.id,
      shortCode: shortUrlsTable.shortCode,
      originalUrl: shortUrlsTable.originalUrl,
      title: shortUrlsTable.title,
      domainId: shortUrlsTable.domainId,
      domainName: shortDomainsTable.domain,
      startDate: shortUrlsTable.startDate,
      endDate: shortUrlsTable.endDate,
      isActive: shortUrlsTable.isActive,
      createdAt: shortUrlsTable.createdAt,
      clickCount: sql<number>`(select count(*) from url_clicks where url_clicks.short_url_id = ${shortUrlsTable.id})`.mapWith(Number),
    })
    .from(shortUrlsTable)
    .leftJoin(shortDomainsTable, eq(shortUrlsTable.domainId, shortDomainsTable.id))
    .orderBy(desc(shortUrlsTable.createdAt));
  res.json(rows);
});

// POST /short-urls
router.post("/short-urls", authenticate, async (req, res): Promise<void> => {
  const { originalUrl, title, startDate, endDate, isActive, customCode, domainId } = req.body;
  if (!originalUrl) { res.status(400).json({ error: "originalUrl is required" }); return; }

  let shortCode = customCode?.trim();
  if (shortCode) {
    const existing = await db.select({ id: shortUrlsTable.id }).from(shortUrlsTable).where(eq(shortUrlsTable.shortCode, shortCode));
    if (existing.length > 0) { res.status(409).json({ error: "Custom code already in use" }); return; }
  } else {
    shortCode = await generateUniqueCode();
  }

  const [row] = await db.insert(shortUrlsTable).values({
    shortCode,
    originalUrl,
    title: title || null,
    domainId: domainId ? Number(domainId) : null,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    isActive: isActive !== false,
    createdBy: req.user!.sub,
  }).returning();

  res.status(201).json(row);
});

// PUT /short-urls/:id
router.put("/short-urls/:id", authenticate, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { originalUrl, title, startDate, endDate, isActive, domainId } = req.body;
  const [row] = await db.update(shortUrlsTable).set({
    originalUrl: originalUrl || undefined,
    title: title ?? null,
    domainId: domainId !== undefined ? (domainId ? Number(domainId) : null) : undefined,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    isActive: isActive !== undefined ? isActive : undefined,
    updatedAt: new Date(),
  }).where(eq(shortUrlsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// DELETE /short-urls/:id
router.delete("/short-urls/:id", authenticate, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(shortUrlsTable).where(eq(shortUrlsTable.id, id));
  res.json({ success: true });
});

// GET /short-urls/:id/analytics
router.get("/short-urls/:id/analytics", authenticate, async (req, res): Promise<void> => {
  const id = Number(req.params.id);

  const [urlRow] = await db
    .select({
      id: shortUrlsTable.id,
      shortCode: shortUrlsTable.shortCode,
      originalUrl: shortUrlsTable.originalUrl,
      title: shortUrlsTable.title,
      domainId: shortUrlsTable.domainId,
      domainName: shortDomainsTable.domain,
      startDate: shortUrlsTable.startDate,
      endDate: shortUrlsTable.endDate,
      isActive: shortUrlsTable.isActive,
      createdAt: shortUrlsTable.createdAt,
    })
    .from(shortUrlsTable)
    .leftJoin(shortDomainsTable, eq(shortUrlsTable.domainId, shortDomainsTable.id))
    .where(eq(shortUrlsTable.id, id));

  if (!urlRow) { res.status(404).json({ error: "Not found" }); return; }

  const clicks = await db.select().from(urlClicksTable).where(eq(urlClicksTable.shortUrlId, id)).orderBy(desc(urlClicksTable.clickedAt));
  const byBrowser = await db.select({ name: urlClicksTable.browser, count: count() }).from(urlClicksTable).where(eq(urlClicksTable.shortUrlId, id)).groupBy(urlClicksTable.browser);
  const byOs = await db.select({ name: urlClicksTable.os, count: count() }).from(urlClicksTable).where(eq(urlClicksTable.shortUrlId, id)).groupBy(urlClicksTable.os);
  const byDevice = await db.select({ name: urlClicksTable.deviceType, count: count() }).from(urlClicksTable).where(eq(urlClicksTable.shortUrlId, id)).groupBy(urlClicksTable.deviceType);
  const byCountry = await db.select({ name: urlClicksTable.country, count: count() }).from(urlClicksTable).where(eq(urlClicksTable.shortUrlId, id)).groupBy(urlClicksTable.country);
  const byDay = await db.select({
    day: sql<string>`date_trunc('day', clicked_at)::date::text`,
    count: count(),
  }).from(urlClicksTable).where(eq(urlClicksTable.shortUrlId, id)).groupBy(sql`date_trunc('day', clicked_at)`).orderBy(sql`date_trunc('day', clicked_at)`);

  res.json({ url: urlRow, clicks, stats: { byBrowser, byOs, byDevice, byCountry, byDay, total: clicks.length } });
});

// Public redirect — GET /s/:code (mounted in app.ts, not under /api)
export async function handleRedirect(req: Request, res: Response): Promise<void> {
  const { code } = req.params;
  const [row] = await db.select().from(shortUrlsTable).where(eq(shortUrlsTable.shortCode, code));

  if (!row || !row.isActive) { res.status(404).send("Link not found or inactive"); return; }

  const now = new Date();
  if (row.startDate && now < new Date(row.startDate)) { res.status(403).send("Link not yet active"); return; }
  if (row.endDate) {
    const endOfDay = new Date(row.endDate);
    endOfDay.setHours(23, 59, 59, 999);
    if (now > endOfDay) { res.status(410).send("Link has expired"); return; }
  }

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "";
  const ua = req.headers["user-agent"] ?? "";
  const referer = req.headers["referer"] ?? "";
  const { browser, browserVersion, os, deviceType } = parseUserAgent(ua);
  const { country, city } = await getGeoLocation(ip);

  db.insert(urlClicksTable).values({
    shortUrlId: row.id,
    ipAddress: ip,
    userAgent: ua,
    browser,
    browserVersion,
    os,
    deviceType,
    country,
    city,
    referer: referer || null,
  }).catch(() => {});

  res.redirect(302, row.originalUrl);
}

export default router;
