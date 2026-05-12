import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, allowedFileTypesTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";

const router: IRouter = Router();

const DEFAULT_TYPES = [
  { extension: ".pdf",  mimeType: "application/pdf",                     label: "PDF Document" },
  { extension: ".docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word Document" },
  { extension: ".xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       label: "Excel Spreadsheet" },
  { extension: ".pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint Presentation" },
  { extension: ".csv",  mimeType: "text/csv",                            label: "CSV File" },
  { extension: ".txt",  mimeType: "text/plain",                          label: "Plain Text" },
  { extension: ".json", mimeType: "application/json",                    label: "JSON File" },
  { extension: ".xml",  mimeType: "application/xml",                     label: "XML File" },
  { extension: ".png",  mimeType: "image/png",                           label: "PNG Image" },
  { extension: ".jpg",  mimeType: "image/jpeg",                          label: "JPEG Image" },
  { extension: ".jpeg", mimeType: "image/jpeg",                          label: "JPEG Image" },
  { extension: ".gif",  mimeType: "image/gif",                           label: "GIF Image" },
  { extension: ".zip",  mimeType: "application/zip",                     label: "ZIP Archive" },
];

async function seedDefaults() {
  for (const t of DEFAULT_TYPES) {
    await db.insert(allowedFileTypesTable).values(t).onConflictDoNothing();
  }
}

// GET /admin/allowed-file-types
router.get("/admin/allowed-file-types", authenticate, requireRole("Admin"), async (_req, res): Promise<void> => {
  await seedDefaults();
  const types = await db.select().from(allowedFileTypesTable).orderBy(allowedFileTypesTable.label);
  res.json(types);
});

// PUT /admin/allowed-file-types/:id — toggle enabled
router.put("/admin/allowed-file-types/:id", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { enabled } = req.body as { enabled: boolean };
  const [updated] = await db.update(allowedFileTypesTable).set({ enabled: !!enabled }).where(eq(allowedFileTypesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "File type not found" }); return; }
  res.json(updated);
});

// POST /admin/allowed-file-types — add custom type
router.post("/admin/allowed-file-types", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { extension, mimeType, label } = req.body as { extension: string; mimeType: string; label: string };
  if (!extension?.trim() || !mimeType?.trim() || !label?.trim()) {
    res.status(400).json({ error: "extension, mimeType, and label are required" });
    return;
  }
  const ext = extension.trim().startsWith(".") ? extension.trim() : `.${extension.trim()}`;
  const [row] = await db.insert(allowedFileTypesTable).values({ extension: ext, mimeType: mimeType.trim(), label: label.trim() }).returning();
  res.status(201).json(row);
});

// DELETE /admin/allowed-file-types/:id
router.delete("/admin/allowed-file-types/:id", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(allowedFileTypesTable).where(eq(allowedFileTypesTable.id, id));
  res.sendStatus(204);
});

// GET /allowed-file-types/enabled — non-admin, returns enabled types for upload validation
router.get("/allowed-file-types/enabled", authenticate, async (_req, res): Promise<void> => {
  await seedDefaults();
  const types = await db.select().from(allowedFileTypesTable).where(eq(allowedFileTypesTable.enabled, true)).orderBy(allowedFileTypesTable.label);
  res.json(types);
});

export default router;
