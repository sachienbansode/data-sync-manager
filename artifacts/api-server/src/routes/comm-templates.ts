import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, commTemplatesTable, commTemplateVersionsTable, usersTable, auditLogsTable } from "@workspace/db";
import { authenticate, requirePageAccess } from "../middlewares/authenticate";

const router: IRouter = Router();

function extractVariables(html: string, subject: string): string[] {
  const combined = `${subject} ${html}`;
  const matches = combined.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map(m => m[1]))];
}

// GET /comm/templates
router.get("/comm/templates", authenticate, requirePageAccess("/email-hub/templates"), async (_req, res): Promise<void> => {
  const rows = await db.select({
    id: commTemplatesTable.id,
    name: commTemplatesTable.name,
    description: commTemplatesTable.description,
    subject: commTemplatesTable.subject,
    variables: commTemplatesTable.variables,
    version: commTemplatesTable.version,
    isActive: commTemplatesTable.isActive,
    createdAt: commTemplatesTable.createdAt,
    updatedAt: commTemplatesTable.updatedAt,
    creatorName: usersTable.name,
  }).from(commTemplatesTable)
    .leftJoin(usersTable, eq(commTemplatesTable.createdBy, usersTable.id))
    .orderBy(desc(commTemplatesTable.updatedAt));
  res.json(rows);
});

// POST /comm/templates
router.post("/comm/templates", authenticate, requirePageAccess("/email-hub/templates"), async (req, res): Promise<void> => {
  const { name, description, subject, htmlBody, textBody, changeNote } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  if (!subject?.trim()) { res.status(400).json({ error: "subject is required" }); return; }
  if (!htmlBody?.trim()) { res.status(400).json({ error: "htmlBody is required" }); return; }

  const variables = extractVariables(htmlBody, subject);

  const [row] = await db.insert(commTemplatesTable).values({
    name: name.trim(),
    description: description ?? null,
    subject: subject.trim(),
    htmlBody,
    textBody: textBody ?? null,
    variables,
    version: 1,
    createdBy: req.user!.sub,
  }).returning();

  await db.insert(commTemplateVersionsTable).values({
    templateId: row.id,
    version: 1,
    subject: row.subject,
    htmlBody: row.htmlBody,
    textBody: row.textBody,
    variables,
    changeNote: changeNote ?? "Initial version",
    changedBy: req.user!.sub,
  });

  db.insert(auditLogsTable).values({ userId: req.user!.sub, userEmail: req.user!.email, action: "COMM_TEMPLATE_CREATED", details: `Created template: ${name}`, resourceType: "comm_template", resourceId: String(row.id) }).catch(() => {});
  res.status(201).json(row);
});

// GET /comm/templates/:id
router.get("/comm/templates/:id", authenticate, requirePageAccess("/email-hub/templates"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select({
    id: commTemplatesTable.id,
    name: commTemplatesTable.name,
    description: commTemplatesTable.description,
    subject: commTemplatesTable.subject,
    htmlBody: commTemplatesTable.htmlBody,
    textBody: commTemplatesTable.textBody,
    variables: commTemplatesTable.variables,
    version: commTemplatesTable.version,
    isActive: commTemplatesTable.isActive,
    createdAt: commTemplatesTable.createdAt,
    updatedAt: commTemplatesTable.updatedAt,
    creatorName: usersTable.name,
  }).from(commTemplatesTable)
    .leftJoin(usersTable, eq(commTemplatesTable.createdBy, usersTable.id))
    .where(eq(commTemplatesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// PUT /comm/templates/:id
router.put("/comm/templates/:id", authenticate, requirePageAccess("/email-hub/templates"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { name, description, subject, htmlBody, textBody, changeNote, isActive } = req.body;

  const [current] = await db.select().from(commTemplatesTable).where(eq(commTemplatesTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  const newVersion = current.version + 1;
  const variables = extractVariables(htmlBody ?? current.htmlBody, subject ?? current.subject);

  const [row] = await db.update(commTemplatesTable).set({
    name: name ?? current.name,
    description: description !== undefined ? description : current.description,
    subject: subject ?? current.subject,
    htmlBody: htmlBody ?? current.htmlBody,
    textBody: textBody !== undefined ? textBody : current.textBody,
    variables,
    version: newVersion,
    isActive: isActive !== undefined ? isActive : current.isActive,
    updatedBy: req.user!.sub,
    updatedAt: new Date(),
  }).where(eq(commTemplatesTable.id, id)).returning();

  await db.insert(commTemplateVersionsTable).values({
    templateId: id,
    version: newVersion,
    subject: row.subject,
    htmlBody: row.htmlBody,
    textBody: row.textBody,
    variables,
    changeNote: changeNote ?? `Updated to v${newVersion}`,
    changedBy: req.user!.sub,
  });

  db.insert(auditLogsTable).values({ userId: req.user!.sub, userEmail: req.user!.email, action: "COMM_TEMPLATE_UPDATED", details: `Updated template: ${row.name} → v${newVersion}`, resourceType: "comm_template", resourceId: String(id) }).catch(() => {});
  res.json(row);
});

// DELETE /comm/templates/:id
router.delete("/comm/templates/:id", authenticate, requirePageAccess("/email-hub/templates"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select({ name: commTemplatesTable.name }).from(commTemplatesTable).where(eq(commTemplatesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(commTemplatesTable).where(eq(commTemplatesTable.id, id));
  db.insert(auditLogsTable).values({ userId: req.user!.sub, userEmail: req.user!.email, action: "COMM_TEMPLATE_DELETED", details: `Deleted template: ${row.name}`, resourceType: "comm_template", resourceId: String(id) }).catch(() => {});
  res.json({ success: true });
});

// GET /comm/templates/:id/versions
router.get("/comm/templates/:id/versions", authenticate, requirePageAccess("/email-hub/templates"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const rows = await db.select({
    id: commTemplateVersionsTable.id,
    version: commTemplateVersionsTable.version,
    subject: commTemplateVersionsTable.subject,
    changeNote: commTemplateVersionsTable.changeNote,
    createdAt: commTemplateVersionsTable.createdAt,
    changedByName: usersTable.name,
  }).from(commTemplateVersionsTable)
    .leftJoin(usersTable, eq(commTemplateVersionsTable.changedBy, usersTable.id))
    .where(eq(commTemplateVersionsTable.templateId, id))
    .orderBy(desc(commTemplateVersionsTable.version));
  res.json(rows);
});

// POST /comm/templates/:id/preview — render HTML with sample variable values
router.post("/comm/templates/:id/preview", authenticate, requirePageAccess("/email-hub/templates"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const sampleData = req.body.sampleData as Record<string, string> | undefined;

  const [row] = await db.select({ htmlBody: commTemplatesTable.htmlBody, subject: commTemplatesTable.subject, variables: commTemplatesTable.variables })
    .from(commTemplatesTable).where(eq(commTemplatesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  let rendered = row.htmlBody;
  let renderedSubject = row.subject;
  if (sampleData) {
    for (const [key, value] of Object.entries(sampleData)) {
      rendered = rendered.replaceAll(`{{${key}}}`, value);
      renderedSubject = renderedSubject.replaceAll(`{{${key}}}`, value);
    }
  }
  res.json({ html: rendered, subject: renderedSubject });
});

export default router;
