import { createHash } from "crypto";
import { eq, and } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/db";
import type { Request, Response, NextFunction } from "express";

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"] as string | undefined;

  const key = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : apiKeyHeader;

  if (!key || !key.startsWith("apk_")) {
    res.status(401).json({ error: "API key required. Pass Authorization: Bearer apk_... or X-Api-Key header." });
    return;
  }

  const prefix = key.slice(0, 12);
  const hash = createHash("sha256").update(key).digest("hex");

  const [apiKey] = await db.select().from(apiKeysTable)
    .where(and(eq(apiKeysTable.keyPrefix, prefix), eq(apiKeysTable.keyHash, hash), eq(apiKeysTable.isActive, true)));

  if (!apiKey) {
    res.status(401).json({ error: "Invalid or inactive API key." });
    return;
  }

  if (apiKey.expiresAt && new Date() > new Date(apiKey.expiresAt)) {
    res.status(401).json({ error: "API key expired." });
    return;
  }

  db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, apiKey.id)).catch(() => {});

  (req as Request & { apiKeyUserId: number }).apiKeyUserId = apiKey.userId;
  next();
}
