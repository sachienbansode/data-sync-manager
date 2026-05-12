import { Router, type IRouter, Request, Response } from "express";
import multer from "multer";
import { eq, and, desc, sql } from "drizzle-orm";
import { URL } from "url";
import * as dns from "dns";
import * as net from "net";
import {
  db,
  apiApplicationsTable,
  apiSpecsTable,
  apiAppRoleAccessTable,
  apiDocAttachmentsTable,
  rolesTable,
} from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import {
  isS3Configured,
  buildS3Key,
  uploadSpecToS3,
  getSpecPresignedUrl,
  fetchUrlAndUploadToS3,
  getSpecContent,
} from "../lib/s3";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// SSRF protection
const PRIVATE_RANGES = [
  /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^127\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^169\.254\.169\.254$/,
];
const IPV6_PRIVATE = [/^::1$/, /^fc/i, /^fd/i, /^fe80/i, /^::$/];

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return PRIVATE_RANGES.some((r) => r.test(ip));
  if (net.isIPv6(ip)) return IPV6_PRIVATE.some((r) => r.test(ip));
  return true;
}

async function validateSpecUrl(rawUrl: string): Promise<string | null> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return "Invalid URL"; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Only http and https URLs are allowed";
  let addresses: string[];
  try {
    const result = await dns.promises.lookup(parsed.hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch { return "Could not resolve hostname"; }
  for (const addr of addresses) {
    if (isPrivateIp(addr)) return "URL resolves to a private or reserved address";
  }
  return null;
}

async function userCanAccessApp(roleId: number, appId: number): Promise<boolean> {
  const [access] = await db.select().from(apiAppRoleAccessTable)
    .where(and(eq(apiAppRoleAccessTable.appId, appId), eq(apiAppRoleAccessTable.roleId, roleId)));
  return !!access;
}

// GET /docs/apps — list apps accessible to current user
router.get("/docs/apps", authenticate, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const isAdmin = user.roleName === "Admin";

  const apps = await db.select({
    id: apiApplicationsTable.id,
    name: apiApplicationsTable.name,
    description: apiApplicationsTable.description,
    tags: apiApplicationsTable.tags,
    createdAt: apiApplicationsTable.createdAt,
  }).from(apiApplicationsTable).orderBy(apiApplicationsTable.name);

  if (isAdmin) {
    const result = await Promise.all(apps.map(async (app) => {
      const [latestSpec] = await db.select().from(apiSpecsTable)
        .where(eq(apiSpecsTable.appId, app.id)).orderBy(desc(apiSpecsTable.version)).limit(1);
      const accessRoles = await db.select({ roleId: apiAppRoleAccessTable.roleId })
        .from(apiAppRoleAccessTable).where(eq(apiAppRoleAccessTable.appId, app.id));
      return { ...app, latestVersion: latestSpec?.version ?? null, latestSpecDate: latestSpec?.uploadedAt ?? null, accessRoleIds: accessRoles.map((r) => r.roleId) };
    }));
    res.json(result);
    return;
  }

  const accessRows = await db.select({ appId: apiAppRoleAccessTable.appId })
    .from(apiAppRoleAccessTable).where(eq(apiAppRoleAccessTable.roleId, user.roleId));
  const allowedAppIds = accessRows.map((r) => r.appId);
  if (allowedAppIds.length === 0) { res.json([]); return; }

  const filteredApps = apps.filter((a) => allowedAppIds.includes(a.id));
  const result = await Promise.all(filteredApps.map(async (app) => {
    const [latestSpec] = await db.select().from(apiSpecsTable)
      .where(and(eq(apiSpecsTable.appId, app.id), eq(apiSpecsTable.isActive, true)))
      .orderBy(desc(apiSpecsTable.version)).limit(1);
    return { ...app, latestVersion: latestSpec?.version ?? null, latestSpecDate: latestSpec?.uploadedAt ?? null, accessRoleIds: [user.roleId] };
  }));
  res.json(result);
});

// POST /docs/apps — register a new application (Admin only)
router.post("/docs/apps", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const { name, description, tags } = req.body;
  if (!name || typeof name !== "string") { res.status(400).json({ error: "name is required" }); return; }
  const cleanTags = Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
  const [app] = await db.insert(apiApplicationsTable)
    .values({ name: name.trim(), description: description?.trim() ?? "", tags: cleanTags, createdBy: req.user!.sub })
    .returning();
  res.status(201).json(app);
});

// PATCH /docs/apps/:id — update app details (Admin only)
router.patch("/docs/apps/:id", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }
  const { name, description, tags } = req.body;
  const updates: Partial<{ name: string; description: string; tags: string[]; updatedAt: Date }> = { updatedAt: new Date() };
  if (name) updates.name = name.trim();
  if (description !== undefined) updates.description = description.trim();
  if (Array.isArray(tags)) updates.tags = tags.map(String).filter(Boolean);
  const [app] = await db.update(apiApplicationsTable).set(updates).where(eq(apiApplicationsTable.id, appId)).returning();
  if (!app) { res.status(404).json({ error: "App not found" }); return; }
  res.json(app);
});

// DELETE /docs/apps/:id — delete app (Admin only)
router.delete("/docs/apps/:id", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }
  await db.delete(apiApplicationsTable).where(eq(apiApplicationsTable.id, appId));
  res.status(204).send();
});

// GET /docs/apps/:id/specs — list all versions for an app
router.get("/docs/apps/:id/specs", authenticate, async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }
  const user = req.user!;
  if (user.roleName !== "Admin") {
    if (!(await userCanAccessApp(user.roleId, appId))) { res.status(403).json({ error: "Access denied" }); return; }
  }
  const specs = await db.select({
    id: apiSpecsTable.id, appId: apiSpecsTable.appId, version: apiSpecsTable.version,
    s3Key: apiSpecsTable.s3Key, specUrl: apiSpecsTable.specUrl,
    hasInlineContent: sql<boolean>`(inline_content IS NOT NULL AND inline_content != '')`,
    isActive: apiSpecsTable.isActive, uploadedAt: apiSpecsTable.uploadedAt,
  }).from(apiSpecsTable).where(eq(apiSpecsTable.appId, appId)).orderBy(desc(apiSpecsTable.version));
  res.json(specs);
});

// POST /docs/apps/:id/specs — upload a new spec version (Admin only)
// Accepts: file upload (multipart), JSON with { specUrl }, JSON with { content } (inline)
router.post(
  "/docs/apps/:id/specs",
  authenticate,
  requireRole("Admin"),
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const appId = Number(req.params.id);
    if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }
    const [app] = await db.select().from(apiApplicationsTable).where(eq(apiApplicationsTable.id, appId));
    if (!app) { res.status(404).json({ error: "App not found" }); return; }

    const [versionRow] = await db.select({ maxVersion: sql<number>`COALESCE(MAX(${apiSpecsTable.version}), 0)` })
      .from(apiSpecsTable).where(eq(apiSpecsTable.appId, appId));
    const nextVersion = (versionRow?.maxVersion ?? 0) + 1;

    const specLabel: string | undefined = req.body?.specLabel?.trim() || undefined;

    if (req.file) {
      // File upload → store inline if small enough, or S3 if configured
      const text = req.file.buffer.toString("utf-8");
      if (isS3Configured()) {
        const s3Key = buildS3Key(appId, nextVersion);
        await uploadSpecToS3(s3Key, req.file.buffer, req.file.mimetype || "application/yaml");
        const [spec] = await db.insert(apiSpecsTable).values({ appId, version: nextVersion, specLabel, s3Key, isActive: true }).returning();
        res.status(201).json(spec);
      } else {
        const [spec] = await db.insert(apiSpecsTable).values({ appId, version: nextVersion, specLabel, inlineContent: text, isActive: true }).returning();
        res.status(201).json(spec);
      }
    } else if (req.body?.content) {
      // Inline content posted as JSON
      const content: string = req.body.content;
      if (!content.trim()) { res.status(400).json({ error: "content cannot be empty" }); return; }
      const [spec] = await db.insert(apiSpecsTable).values({ appId, version: nextVersion, specLabel, inlineContent: content, isActive: true }).returning();
      res.status(201).json(spec);
    } else if (req.body?.specUrl) {
      const specUrl: string = req.body.specUrl;
      const urlError = await validateSpecUrl(specUrl);
      if (urlError) { res.status(400).json({ error: urlError }); return; }
      if (isS3Configured()) {
        const s3Key = buildS3Key(appId, nextVersion);
        await fetchUrlAndUploadToS3(specUrl, s3Key);
        const [spec] = await db.insert(apiSpecsTable).values({ appId, version: nextVersion, specLabel, s3Key, specUrl, isActive: true }).returning();
        res.status(201).json(spec);
      } else {
        const [spec] = await db.insert(apiSpecsTable).values({ appId, version: nextVersion, specLabel, specUrl, isActive: true }).returning();
        res.status(201).json(spec);
      }
    } else {
      res.status(400).json({ error: "Provide a file upload, inline content (content field), or a specUrl" });
    }
  }
);

// PUT /docs/apps/:id/specs/:version/content — update inline content of a spec (Admin only)
router.put("/docs/apps/:id/specs/:version/content", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  const version = Number(req.params.version);
  if (isNaN(appId) || isNaN(version)) { res.status(400).json({ error: "Invalid app id or version" }); return; }
  const { content } = req.body as { content: string };
  if (!content || !content.trim()) { res.status(400).json({ error: "content is required" }); return; }
  const [updated] = await db.update(apiSpecsTable).set({ inlineContent: content })
    .where(and(eq(apiSpecsTable.appId, appId), eq(apiSpecsTable.version, version))).returning();
  if (!updated) { res.status(404).json({ error: "Spec version not found" }); return; }
  res.json({ ok: true, version: updated.version });
});

// GET /docs/apps/:id/specs/:version — get spec content/URL for a specific version
router.get("/docs/apps/:id/specs/:version", authenticate, async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  const version = Number(req.params.version);
  if (isNaN(appId) || isNaN(version)) { res.status(400).json({ error: "Invalid app id or version" }); return; }
  const user = req.user!;
  if (user.roleName !== "Admin") {
    if (!(await userCanAccessApp(user.roleId, appId))) { res.status(403).json({ error: "Access denied" }); return; }
  }
  const [spec] = await db.select().from(apiSpecsTable)
    .where(and(eq(apiSpecsTable.appId, appId), eq(apiSpecsTable.version, version)));
  if (!spec) { res.status(404).json({ error: "Spec version not found" }); return; }

  // Priority: inline content > S3 > URL reference
  if (spec.inlineContent) {
    res.json({ type: "inline", content: spec.inlineContent, version: spec.version });
    return;
  }
  if (spec.s3Key && isS3Configured()) {
    try {
      const presignedUrl = await getSpecPresignedUrl(spec.s3Key);
      res.json({ type: "presigned_url", url: presignedUrl, version: spec.version, specUrl: spec.specUrl });
      return;
    } catch {
      try {
        const content = await getSpecContent(spec.s3Key);
        res.json({ type: "inline", content, version: spec.version });
        return;
      } catch {
        res.status(500).json({ error: "Failed to retrieve spec from storage" });
        return;
      }
    }
  }
  if (spec.specUrl) {
    res.json({ type: "url", url: spec.specUrl, version: spec.version });
    return;
  }
  res.status(404).json({ error: "No spec content available for this version" });
});

// GET /docs/apps/:id/specs/:version/raw — return raw inline content for editing (Admin only)
router.get("/docs/apps/:id/specs/:version/raw", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  const version = Number(req.params.version);
  if (isNaN(appId) || isNaN(version)) { res.status(400).json({ error: "Invalid" }); return; }
  const [spec] = await db.select().from(apiSpecsTable)
    .where(and(eq(apiSpecsTable.appId, appId), eq(apiSpecsTable.version, version)));
  if (!spec) { res.status(404).json({ error: "Spec version not found" }); return; }
  res.json({ content: spec.inlineContent ?? "", version: spec.version });
});

// GET /docs/apps/:id/rbac — get role access list (Admin only)
router.get("/docs/apps/:id/rbac", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }
  const roles = await db.select().from(rolesTable).orderBy(rolesTable.id);
  const access = await db.select().from(apiAppRoleAccessTable).where(eq(apiAppRoleAccessTable.appId, appId));
  const allowedRoleIds = new Set(access.map((a) => a.roleId));
  res.json(roles.map((role) => ({ roleId: role.id, roleName: role.name, hasAccess: allowedRoleIds.has(role.id) })));
});

// PUT /docs/apps/:id/rbac — set role access (Admin only)
router.put("/docs/apps/:id/rbac", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }
  const { roleIds } = req.body;
  if (!Array.isArray(roleIds)) { res.status(400).json({ error: "roleIds must be an array" }); return; }
  await db.delete(apiAppRoleAccessTable).where(eq(apiAppRoleAccessTable.appId, appId));
  if (roleIds.length > 0) {
    await db.insert(apiAppRoleAccessTable).values(roleIds.map((roleId: number) => ({ appId, roleId })));
  }
  const roles = await db.select().from(rolesTable).orderBy(rolesTable.id);
  const access = await db.select().from(apiAppRoleAccessTable).where(eq(apiAppRoleAccessTable.appId, appId));
  const allowedRoleIds = new Set(access.map((a) => a.roleId));
  res.json(roles.map((role) => ({ roleId: role.id, roleName: role.name, hasAccess: allowedRoleIds.has(role.id) })));
});

// GET /docs/apps/:id/attachments — list attachments for an app
router.get("/docs/apps/:id/attachments", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }
  const attachments = await db.select({
    id: apiDocAttachmentsTable.id,
    fileName: apiDocAttachmentsTable.fileName,
    fileSize: apiDocAttachmentsTable.fileSize,
    mimeType: apiDocAttachmentsTable.mimeType,
    uploadedAt: apiDocAttachmentsTable.uploadedAt,
  }).from(apiDocAttachmentsTable).where(eq(apiDocAttachmentsTable.appId, appId)).orderBy(apiDocAttachmentsTable.uploadedAt);
  res.json(attachments);
});

// POST /docs/apps/:id/attachments — upload supporting document (max 5 per app)
router.post(
  "/docs/apps/:id/attachments",
  authenticate,
  requireRole("Admin"),
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const appId = Number(req.params.id);
    if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(apiDocAttachmentsTable).where(eq(apiDocAttachmentsTable.appId, appId));
    if (count >= 5) { res.status(400).json({ error: "Maximum 5 attachments per API application reached" }); return; }
    const content = req.file.buffer.toString("base64");
    const [attachment] = await db.insert(apiDocAttachmentsTable).values({
      appId,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      content,
    }).returning();
    res.status(201).json({
      id: attachment!.id,
      fileName: attachment!.fileName,
      fileSize: attachment!.fileSize,
      mimeType: attachment!.mimeType,
      uploadedAt: attachment!.uploadedAt,
    });
  }
);

// DELETE /docs/apps/:id/attachments/:attachId
router.delete("/docs/apps/:id/attachments/:attachId", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  const attachId = Number(req.params.attachId);
  if (isNaN(appId) || isNaN(attachId)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(apiDocAttachmentsTable).where(and(eq(apiDocAttachmentsTable.id, attachId), eq(apiDocAttachmentsTable.appId, appId)));
  res.sendStatus(204);
});

// GET /docs/apps/:id/attachments/:attachId/download — download a supporting document
router.get("/docs/apps/:id/attachments/:attachId/download", authenticate, async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  const attachId = Number(req.params.attachId);
  if (isNaN(appId) || isNaN(attachId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const user = req.user!;
  if (user.roleName !== "Admin") {
    if (!(await userCanAccessApp(user.roleId, appId))) { res.status(403).json({ error: "Access denied" }); return; }
  }
  const [attachment] = await db.select().from(apiDocAttachmentsTable)
    .where(and(eq(apiDocAttachmentsTable.id, attachId), eq(apiDocAttachmentsTable.appId, appId)));
  if (!attachment) { res.status(404).json({ error: "Attachment not found" }); return; }
  const buffer = Buffer.from(attachment.content, "base64");
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${attachment.fileName}"`);
  res.setHeader("Content-Length", String(buffer.length));
  res.send(buffer);
});

export default router;
