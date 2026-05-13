/**
 * Public REST API v1 — authenticated via API keys
 * Base path: /api/v1
 */
import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, shortUrlsTable, shortDomainsTable, urlClicksTable } from "@workspace/db";
import { apiKeyAuth } from "../middlewares/api-key-auth";

type AuthRequest = import("express").Request & { apiKeyUserId: number };

const router: IRouter = Router();

// GET /api/v1/urls — list the calling user's short URLs
router.get("/urls", apiKeyAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthRequest).apiKeyUserId;
  const rows = await db
    .select({
      id: shortUrlsTable.id,
      shortCode: shortUrlsTable.shortCode,
      originalUrl: shortUrlsTable.originalUrl,
      title: shortUrlsTable.title,
      description: shortUrlsTable.description,
      domainId: shortUrlsTable.domainId,
      domainName: shortDomainsTable.domain,
      isActive: shortUrlsTable.isActive,
      startDate: shortUrlsTable.startDate,
      endDate: shortUrlsTable.endDate,
      createdAt: shortUrlsTable.createdAt,
      clickCount: sql<number>`(select count(*) from url_clicks where url_clicks.short_url_id = ${shortUrlsTable.id})`.mapWith(Number),
    })
    .from(shortUrlsTable)
    .leftJoin(shortDomainsTable, eq(shortUrlsTable.domainId, shortDomainsTable.id))
    .where(eq(shortUrlsTable.createdBy, userId))
    .orderBy(desc(shortUrlsTable.createdAt));
  res.json({ data: rows, count: rows.length });
});

// POST /api/v1/urls — create a short URL
router.post("/urls", apiKeyAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthRequest).apiKeyUserId;
  const { originalUrl, title, description, isActive, startDate, endDate, domainId } = req.body;
  if (!originalUrl) { res.status(400).json({ error: "originalUrl is required" }); return; }

  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = Array.from({ length: 7 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  while ((await db.select({ id: shortUrlsTable.id }).from(shortUrlsTable).where(eq(shortUrlsTable.shortCode, code))).length > 0) {
    code = Array.from({ length: 7 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  const [row] = await db.insert(shortUrlsTable).values({
    shortCode: code,
    originalUrl,
    title: title ?? null,
    description: description ?? null,
    domainId: domainId ? Number(domainId) : null,
    isActive: isActive !== false,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    createdBy: userId,
  }).returning();

  const shortUrl = row.domainId ? null : `${req.protocol}://${req.hostname}/s/${code}`;
  res.status(201).json({ ...row, shortUrl });
});

// GET /api/v1/urls/:code — get URL info by short code
router.get("/urls/:code", apiKeyAuth, async (req, res): Promise<void> => {
  const [row] = await db
    .select({
      id: shortUrlsTable.id,
      shortCode: shortUrlsTable.shortCode,
      originalUrl: shortUrlsTable.originalUrl,
      title: shortUrlsTable.title,
      description: shortUrlsTable.description,
      isActive: shortUrlsTable.isActive,
      domainName: shortDomainsTable.domain,
      startDate: shortUrlsTable.startDate,
      endDate: shortUrlsTable.endDate,
      createdAt: shortUrlsTable.createdAt,
      clickCount: sql<number>`(select count(*) from url_clicks where url_clicks.short_url_id = ${shortUrlsTable.id})`.mapWith(Number),
    })
    .from(shortUrlsTable)
    .leftJoin(shortDomainsTable, eq(shortUrlsTable.domainId, shortDomainsTable.id))
    .where(eq(shortUrlsTable.shortCode, req.params.code));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// GET /api/v1/urls/:code/stats — click analytics summary
router.get("/urls/:code/stats", apiKeyAuth, async (req, res): Promise<void> => {
  const [url] = await db.select({ id: shortUrlsTable.id }).from(shortUrlsTable).where(eq(shortUrlsTable.shortCode, req.params.code));
  if (!url) { res.status(404).json({ error: "Not found" }); return; }

  const [totalRow] = await db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(urlClicksTable).where(eq(urlClicksTable.shortUrlId, url.id));
  res.json({ shortCode: req.params.code, totalClicks: totalRow.total });
});

// DELETE /api/v1/urls/:code — delete a short URL (owner only)
router.delete("/urls/:code", apiKeyAuth, async (req, res): Promise<void> => {
  const userId = (req as AuthRequest).apiKeyUserId;
  const [row] = await db.select({ id: shortUrlsTable.id, createdBy: shortUrlsTable.createdBy }).from(shortUrlsTable).where(eq(shortUrlsTable.shortCode, req.params.code));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.createdBy !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(shortUrlsTable).where(eq(shortUrlsTable.id, row.id));
  res.json({ success: true });
});

export default router;
