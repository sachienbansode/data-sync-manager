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

export default router;
