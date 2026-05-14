import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { Resolver } from "dns/promises";
import { randomBytes } from "crypto";
import { db, shortDomainsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";

const router: IRouter = Router();

// GET /short-domains
router.get("/short-domains", authenticate, async (_req, res): Promise<void> => {
  const rows = await db.select().from(shortDomainsTable).orderBy(shortDomainsTable.domain);
  res.json(rows);
});

// POST /short-domains (admin only)
router.post("/short-domains", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { domain } = req.body;
  if (!domain) { res.status(400).json({ error: "domain is required" }); return; }

  const normalized = (domain as string).trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!normalized || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized)) {
    res.status(400).json({ error: "Invalid domain format" }); return;
  }

  const existing = await db.select({ id: shortDomainsTable.id }).from(shortDomainsTable)
    .where(eq(shortDomainsTable.domain, normalized));
  if (existing.length > 0) { res.status(409).json({ error: "Domain already exists" }); return; }

  const verificationToken = `ashika-verify-${randomBytes(16).toString("hex")}`;
  const [row] = await db.insert(shortDomainsTable).values({
    domain: normalized,
    verificationToken,
    createdBy: req.user!.sub,
  }).returning();

  res.status(201).json(row);
});

// POST /short-domains/:id/verify — do DNS TXT lookup
router.post("/short-domains/:id/verify", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [domain] = await db.select().from(shortDomainsTable).where(eq(shortDomainsTable.id, id));
  if (!domain) { res.status(404).json({ error: "Not found" }); return; }

  try {
    const resolver = new Resolver();
    resolver.setServers(["8.8.8.8", "1.1.1.1"]);
    const records = await resolver.resolveTxt(domain.domain);
    const flat = records.flat();
    const verified = flat.some(r => r === domain.verificationToken);

    if (verified) {
      const [updated] = await db.update(shortDomainsTable).set({
        isVerified: true,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(shortDomainsTable.id, id)).returning();
      res.json({ success: true, domain: updated });
    } else {
      res.json({ success: false, message: "TXT record not found. Make sure you added it and DNS has propagated (can take up to 48 hours)." });
    }
  } catch (err) {
    res.json({ success: false, message: `DNS lookup failed: ${err instanceof Error ? err.message : "Unknown error"}` });
  }
});

// DELETE /short-domains/:id
router.delete("/short-domains/:id", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(shortDomainsTable).where(eq(shortDomainsTable.id, id));
  res.json({ success: true });
});

export default router;
