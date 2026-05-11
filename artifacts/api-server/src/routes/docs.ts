import { Router, type IRouter, Request, Response } from "express";
import multer from "multer";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { URL } from "url";
import * as dns from "dns";
import * as net from "net";
import {
  db,
  apiApplicationsTable,
  apiSpecsTable,
  apiAppRoleAccessTable,
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

// Private/reserved CIDR ranges to block (SSRF protection)
const PRIVATE_RANGES = [
  // IPv4
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  // Cloud metadata
  /^169\.254\.169\.254$/,
];

const IPV6_PRIVATE = [
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80/i,
  /^::$/,
];

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return PRIVATE_RANGES.some((r) => r.test(ip));
  if (net.isIPv6(ip)) return IPV6_PRIVATE.some((r) => r.test(ip));
  return true; // unknown format — block it
}

async function validateSpecUrl(rawUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Invalid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http and https URLs are allowed";
  }
  const hostname = parsed.hostname;
  // Resolve the hostname to IP(s) and check each one
  let addresses: string[];
  try {
    const result = await dns.promises.lookup(hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch {
    return "Could not resolve hostname";
  }
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      return "URL resolves to a private or reserved address";
    }
  }
  return null; // valid
}

async function userCanAccessApp(roleId: number, appId: number): Promise<boolean> {
  const [access] = await db
    .select()
    .from(apiAppRoleAccessTable)
    .where(and(eq(apiAppRoleAccessTable.appId, appId), eq(apiAppRoleAccessTable.roleId, roleId)));
  return !!access;
}

// GET /docs/apps — list apps accessible to the current user's role
router.get("/docs/apps", authenticate, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const isAdmin = user.roleName === "Admin";

  const apps = await db
    .select({
      id: apiApplicationsTable.id,
      name: apiApplicationsTable.name,
      description: apiApplicationsTable.description,
      tags: apiApplicationsTable.tags,
      createdAt: apiApplicationsTable.createdAt,
    })
    .from(apiApplicationsTable)
    .orderBy(apiApplicationsTable.name);

  if (isAdmin) {
    // Admins see all apps; enrich with latest spec info
    const result = await Promise.all(
      apps.map(async (app) => {
        const [latestSpec] = await db
          .select()
          .from(apiSpecsTable)
          .where(eq(apiSpecsTable.appId, app.id))
          .orderBy(desc(apiSpecsTable.version))
          .limit(1);
        const accessRoles = await db
          .select({ roleId: apiAppRoleAccessTable.roleId })
          .from(apiAppRoleAccessTable)
          .where(eq(apiAppRoleAccessTable.appId, app.id));
        return {
          ...app,
          latestVersion: latestSpec?.version ?? null,
          latestSpecDate: latestSpec?.uploadedAt ?? null,
          accessRoleIds: accessRoles.map((r) => r.roleId),
        };
      })
    );
    res.json(result);
    return;
  }

  // Non-admins: filter by role access
  const accessRows = await db
    .select({ appId: apiAppRoleAccessTable.appId })
    .from(apiAppRoleAccessTable)
    .where(eq(apiAppRoleAccessTable.roleId, user.roleId));

  const allowedAppIds = accessRows.map((r) => r.appId);

  if (allowedAppIds.length === 0) {
    res.json([]);
    return;
  }

  const filteredApps = apps.filter((a) => allowedAppIds.includes(a.id));

  const result = await Promise.all(
    filteredApps.map(async (app) => {
      const [latestSpec] = await db
        .select()
        .from(apiSpecsTable)
        .where(and(eq(apiSpecsTable.appId, app.id), eq(apiSpecsTable.isActive, true)))
        .orderBy(desc(apiSpecsTable.version))
        .limit(1);
      return {
        ...app,
        latestVersion: latestSpec?.version ?? null,
        latestSpecDate: latestSpec?.uploadedAt ?? null,
        accessRoleIds: [user.roleId],
      };
    })
  );

  res.json(result);
});

// POST /docs/apps — register a new application (Admin only)
router.post("/docs/apps", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const { name, description, tags } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const cleanTags = Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
  const [app] = await db
    .insert(apiApplicationsTable)
    .values({ name: name.trim(), description: description?.trim() ?? "", tags: cleanTags, createdBy: req.user!.sub })
    .returning();
  res.status(201).json(app);
});

// PATCH /docs/apps/:id — update app details (Admin only)
router.patch("/docs/apps/:id", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }

  const { name, description, tags } = req.body;
  const updates: Partial<{ name: string; description: string; tags: string[] }> = {};
  if (name) updates.name = name.trim();
  if (description !== undefined) updates.description = description.trim();
  if (Array.isArray(tags)) updates.tags = tags.map(String).filter(Boolean);

  const [app] = await db
    .update(apiApplicationsTable)
    .set(updates)
    .where(eq(apiApplicationsTable.id, appId))
    .returning();

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
    const canAccess = await userCanAccessApp(user.roleId, appId);
    if (!canAccess) { res.status(403).json({ error: "Access denied to this application" }); return; }
  }

  const specs = await db
    .select()
    .from(apiSpecsTable)
    .where(eq(apiSpecsTable.appId, appId))
    .orderBy(desc(apiSpecsTable.version));

  res.json(specs);
});

// POST /docs/apps/:id/specs — upload a new spec version (Admin only)
// Accepts either a file upload (multipart) or a JSON body with { specUrl }
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

    // Determine next version number
    const [versionRow] = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(${apiSpecsTable.version}), 0)` })
      .from(apiSpecsTable)
      .where(eq(apiSpecsTable.appId, appId));
    const nextVersion = (versionRow?.maxVersion ?? 0) + 1;

    const s3Key = buildS3Key(appId, nextVersion);

    if (req.file) {
      // File upload path
      if (!isS3Configured()) {
        res.status(503).json({ error: "S3 is not configured. Set AWS environment variables to enable file uploads." });
        return;
      }
      await uploadSpecToS3(s3Key, req.file.buffer, req.file.mimetype || "application/yaml");
      
      // Mark previous specs as inactive, new as active
      await db.update(apiSpecsTable).set({ isActive: false }).where(eq(apiSpecsTable.appId, appId));
      const [spec] = await db
        .insert(apiSpecsTable)
        .values({ appId, version: nextVersion, s3Key, isActive: true })
        .returning();
      res.status(201).json(spec);
    } else if (req.body?.specUrl) {
      const specUrl: string = req.body.specUrl;

      const urlError = await validateSpecUrl(specUrl);
      if (urlError) {
        res.status(400).json({ error: urlError });
        return;
      }

      if (isS3Configured()) {
        // Fetch and cache in S3
        await fetchUrlAndUploadToS3(specUrl, s3Key);
        await db.update(apiSpecsTable).set({ isActive: false }).where(eq(apiSpecsTable.appId, appId));
        const [spec] = await db
          .insert(apiSpecsTable)
          .values({ appId, version: nextVersion, s3Key, specUrl, isActive: true })
          .returning();
        res.status(201).json(spec);
      } else {
        // Store URL reference only
        await db.update(apiSpecsTable).set({ isActive: false }).where(eq(apiSpecsTable.appId, appId));
        const [spec] = await db
          .insert(apiSpecsTable)
          .values({ appId, version: nextVersion, specUrl, isActive: true })
          .returning();
        res.status(201).json(spec);
      }
    } else {
      res.status(400).json({ error: "Provide either a file upload or a specUrl in the request body" });
    }
  }
);

// GET /docs/apps/:id/specs/:version — get spec content/URL for a specific version
router.get("/docs/apps/:id/specs/:version", authenticate, async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  const version = Number(req.params.version);
  if (isNaN(appId) || isNaN(version)) { res.status(400).json({ error: "Invalid app id or version" }); return; }

  const user = req.user!;
  if (user.roleName !== "Admin") {
    const canAccess = await userCanAccessApp(user.roleId, appId);
    if (!canAccess) { res.status(403).json({ error: "Access denied to this application" }); return; }
  }

  const [spec] = await db
    .select()
    .from(apiSpecsTable)
    .where(and(eq(apiSpecsTable.appId, appId), eq(apiSpecsTable.version, version)));

  if (!spec) { res.status(404).json({ error: "Spec version not found" }); return; }

  if (spec.s3Key && isS3Configured()) {
    try {
      // Return pre-signed URL for direct browser access (Swagger UI can fetch it)
      const presignedUrl = await getSpecPresignedUrl(spec.s3Key);
      res.json({ type: "presigned_url", url: presignedUrl, version: spec.version, specUrl: spec.specUrl });
    } catch {
      // Fall back to inline content if presigned URL fails
      try {
        const content = await getSpecContent(spec.s3Key);
        res.json({ type: "inline", content, version: spec.version });
      } catch (err) {
        res.status(500).json({ error: "Failed to retrieve spec from storage" });
      }
    }
  } else if (spec.specUrl) {
    // Return the original URL for Swagger UI to fetch
    res.json({ type: "url", url: spec.specUrl, version: spec.version });
  } else {
    res.status(404).json({ error: "No spec content available for this version" });
  }
});

// GET /docs/apps/:id/rbac — get role access list for an app (Admin only)
router.get("/docs/apps/:id/rbac", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }

  const roles = await db.select().from(rolesTable).orderBy(rolesTable.id);
  const access = await db
    .select()
    .from(apiAppRoleAccessTable)
    .where(eq(apiAppRoleAccessTable.appId, appId));

  const allowedRoleIds = new Set(access.map((a) => a.roleId));

  const result = roles.map((role) => ({
    roleId: role.id,
    roleName: role.name,
    hasAccess: allowedRoleIds.has(role.id),
  }));

  res.json(result);
});

// PUT /docs/apps/:id/rbac — set role access for an app (Admin only)
router.put("/docs/apps/:id/rbac", authenticate, requireRole("Admin"), async (req: Request, res: Response): Promise<void> => {
  const appId = Number(req.params.id);
  if (isNaN(appId)) { res.status(400).json({ error: "Invalid app id" }); return; }

  const { roleIds } = req.body;
  if (!Array.isArray(roleIds)) {
    res.status(400).json({ error: "roleIds must be an array of role IDs" });
    return;
  }

  // Delete all existing access entries for this app
  await db.delete(apiAppRoleAccessTable).where(eq(apiAppRoleAccessTable.appId, appId));

  // Insert new access entries
  if (roleIds.length > 0) {
    await db.insert(apiAppRoleAccessTable).values(
      roleIds.map((roleId: number) => ({ appId, roleId }))
    );
  }

  const roles = await db.select().from(rolesTable).orderBy(rolesTable.id);
  const access = await db
    .select()
    .from(apiAppRoleAccessTable)
    .where(eq(apiAppRoleAccessTable.appId, appId));

  const allowedRoleIds = new Set(access.map((a) => a.roleId));
  const result = roles.map((role) => ({
    roleId: role.id,
    roleName: role.name,
    hasAccess: allowedRoleIds.has(role.id),
  }));

  res.json(result);
});

export default router;
