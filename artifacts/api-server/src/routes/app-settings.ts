import { Router, type IRouter } from "express";
import multer from "multer";
import { db, appSettingsTable, auditLogsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB max
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image files are allowed"));
      return;
    }
    cb(null, true);
  },
});

async function getOrCreateSettings() {
  const [cfg] = await db.select().from(appSettingsTable).limit(1);
  if (cfg) return cfg;
  const [created] = await db.insert(appSettingsTable).values({ appName: "Ashika Platform" }).returning();
  return created!;
}

// GET /admin/app-settings — public (no auth needed for basic branding info)
router.get("/admin/app-settings", async (_req, res): Promise<void> => {
  const cfg = await getOrCreateSettings();
  res.json({
    id: cfg.id,
    appName: cfg.appName,
    hasLogo: !!cfg.logoData,
    fontFamily: cfg.fontFamily,
    menuFontSize: cfg.menuFontSize,
    bodyFontSize: cfg.bodyFontSize,
    headingFontSize: cfg.headingFontSize,
    piiPreviewEnabled: cfg.piiPreviewEnabled,
    updatedAt: cfg.updatedAt,
  });
});

// GET /admin/app-settings/logo — serve the logo image (no auth needed so it can be used in <img>)
router.get("/admin/app-settings/logo", async (_req, res): Promise<void> => {
  const [cfg] = await db.select().from(appSettingsTable).limit(1);
  if (!cfg?.logoData || !cfg.logoMimeType) {
    res.status(404).json({ error: "No logo uploaded" });
    return;
  }
  const buffer = Buffer.from(cfg.logoData, "base64");
  res.setHeader("Content-Type", cfg.logoMimeType);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(buffer);
});

// PUT /admin/app-settings — update app name
router.put("/admin/app-settings", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { appName } = req.body as { appName?: string };
  if (!appName?.trim()) {
    res.status(400).json({ error: "appName is required" });
    return;
  }

  const cfg = await getOrCreateSettings();
  await db.update(appSettingsTable).set({ appName: appName.trim() });

  const user = (req as Express.Request & { user?: { id: number; email: string } }).user;
  await db.insert(auditLogsTable).values({
    userId: user?.id ?? null, userEmail: user?.email ?? null,
    action: "APP_SETTINGS_UPDATED", details: `App name set to: ${appName.trim()}`,
    ipAddress: req.ip ?? null,
  });

  res.json({ success: true, id: cfg.id, appName: appName.trim() });
});

// GET /admin/pii-preview-settings
router.get("/admin/pii-preview-settings", authenticate, requireRole("Admin"), async (_req, res): Promise<void> => {
  const cfg = await getOrCreateSettings();
  res.json({ piiPreviewEnabled: cfg.piiPreviewEnabled });
});

// PUT /admin/pii-preview-settings — toggle PII masking in Data Preview
router.put("/admin/pii-preview-settings", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { piiPreviewEnabled } = req.body as { piiPreviewEnabled?: boolean };
  if (typeof piiPreviewEnabled !== "boolean") {
    res.status(400).json({ error: "piiPreviewEnabled must be a boolean" }); return;
  }
  await getOrCreateSettings();
  await db.update(appSettingsTable).set({ piiPreviewEnabled });

  const user = (req as Express.Request & { user?: { id: number; email: string } }).user;
  await db.insert(auditLogsTable).values({
    userId: user?.id ?? null, userEmail: user?.email ?? null,
    action: "PII_PREVIEW_SETTINGS_UPDATED",
    details: `PII masking in Data Preview: ${piiPreviewEnabled ? "ENABLED" : "DISABLED"}`,
    ipAddress: req.ip ?? null,
  });

  res.json({ success: true, piiPreviewEnabled });
});

// GET /admin/font-settings
router.get("/admin/font-settings", authenticate, requireRole("Admin"), async (_req, res): Promise<void> => {
  const cfg = await getOrCreateSettings();
  res.json({
    fontFamily: cfg.fontFamily,
    menuFontSize: cfg.menuFontSize,
    bodyFontSize: cfg.bodyFontSize,
    headingFontSize: cfg.headingFontSize,
  });
});

// PUT /admin/font-settings
router.put("/admin/font-settings", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { fontFamily, menuFontSize, bodyFontSize, headingFontSize } = req.body as {
    fontFamily?: string; menuFontSize?: string; bodyFontSize?: string; headingFontSize?: string;
  };
  await getOrCreateSettings();
  const updates: Record<string, string> = {};
  if (fontFamily?.trim()) updates.fontFamily = fontFamily.trim();
  if (menuFontSize?.trim()) updates.menuFontSize = menuFontSize.trim();
  if (bodyFontSize?.trim()) updates.bodyFontSize = bodyFontSize.trim();
  if (headingFontSize?.trim()) updates.headingFontSize = headingFontSize.trim();
  if (Object.keys(updates).length > 0) {
    await db.update(appSettingsTable).set(updates);
  }
  const user = (req as Express.Request & { user?: { id: number; email: string } }).user;
  await db.insert(auditLogsTable).values({
    userId: user?.id ?? null, userEmail: user?.email ?? null,
    action: "FONT_SETTINGS_UPDATED", details: `Font: ${fontFamily}, sizes: menu=${menuFontSize}, body=${bodyFontSize}, heading=${headingFontSize}`,
    ipAddress: req.ip ?? null,
  });
  const cfg = await getOrCreateSettings();
  res.json({ fontFamily: cfg.fontFamily, menuFontSize: cfg.menuFontSize, bodyFontSize: cfg.bodyFontSize, headingFontSize: cfg.headingFontSize });
});

// POST /admin/app-settings/logo — upload logo image
router.post("/admin/app-settings/logo", authenticate, requireRole("Admin"), (req, res, next) => {
  upload.single("logo")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}, async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const logoData = req.file.buffer.toString("base64");
  const logoMimeType = req.file.mimetype;

  await getOrCreateSettings();
  await db.update(appSettingsTable).set({ logoData, logoMimeType });

  const user = (req as Express.Request & { user?: { id: number; email: string } }).user;
  await db.insert(auditLogsTable).values({
    userId: user?.id ?? null, userEmail: user?.email ?? null,
    action: "APP_LOGO_UPDATED", details: `Logo uploaded: ${req.file.originalname} (${req.file.size} bytes)`,
    ipAddress: req.ip ?? null,
  });

  res.json({ success: true, hasLogo: true });
});

// GET /admin/rpa-settings — read RPA runtime settings
router.get("/admin/rpa-settings", authenticate, requireRole("Admin"), async (_req, res): Promise<void> => {
  const cfg = await getOrCreateSettings();
  res.json({ rpaNotifyIntervalSec: cfg.rpaNotifyIntervalSec ?? 60 });
});

// PUT /admin/rpa-settings — update RPA runtime settings
router.put("/admin/rpa-settings", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { rpaNotifyIntervalSec } = req.body as { rpaNotifyIntervalSec?: number };
  if (!Number.isInteger(rpaNotifyIntervalSec) || rpaNotifyIntervalSec < 10 || rpaNotifyIntervalSec > 3600) {
    res.status(400).json({ error: "rpaNotifyIntervalSec must be an integer between 10 and 3600 seconds" });
    return;
  }
  await getOrCreateSettings();
  await db.update(appSettingsTable).set({ rpaNotifyIntervalSec });

  const user = (req as Express.Request & { user?: { sub?: number; email?: string } }).user;
  await db.insert(auditLogsTable).values({
    userId: user?.sub ?? null,
    userEmail: user?.email ?? null,
    action: "RPA_SETTINGS_UPDATED",
    details: JSON.stringify({ rpaNotifyIntervalSec }),
    ipAddress: req.ip ?? null,
    resourceType: "rpa_settings",
    resourceId: "1",
  });

  res.json({ rpaNotifyIntervalSec });
});

export default router;
