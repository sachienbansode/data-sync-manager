import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, emailTemplatesTable, auditLogsTable, smtpSettingsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { sendMail } from "../lib/mailer";

const router: IRouter = Router();

function getIp(req: import("express").Request): string | null {
  return Array.isArray(req.ip) ? (req.ip[0] ?? null) : (req.ip ?? null);
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

const SYSTEM_TEMPLATES: Array<typeof emailTemplatesTable.$inferInsert> = [
  {
    slug: "otp_login",
    name: "OTP Login Email",
    description: "Sent to users when they request a one-time login code.",
    subject: "Your {{appName}} Login OTP",
    body: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto">
  <p>Hello {{firstName}},</p>
  <p>Your one-time login code is:</p>
  <h2 style="letter-spacing:8px;font-family:monospace;font-size:36px;color:#1a1a1a;margin:16px 0">{{otp}}</h2>
  <p>This code expires in <strong>{{expiryMinutes}} minutes</strong>.</p>
  <p style="color:#6b7280;font-size:13px">If you did not request this, please ignore this email.</p>
</div>`,
    variables: ["firstName", "otp", "expiryMinutes", "appName"],
    isSystem: true,
  },
  {
    slug: "pipeline_success",
    name: "Pipeline Success Notification",
    description: "Sent to configured recipients when a pipeline run completes successfully.",
    subject: "Pipeline \"{{pipelineName}}\" completed successfully",
    body: `<div style="font-family:sans-serif;max-width:600px">
  <h2 style="color:#16a34a">Pipeline Run Successful</h2>
  <p>Pipeline <strong>{{pipelineName}}</strong> completed successfully.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;width:140px">Pipeline</td>
        <td style="padding:8px;border:1px solid #e5e7eb">{{pipelineName}} (ID: {{pipelineId}})</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Records</td>
        <td style="padding:8px;border:1px solid #e5e7eb;color:#16a34a">{{recordCount}} row(s) transferred</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Completed (IST)</td>
        <td style="padding:8px;border:1px solid #e5e7eb">{{completedAt}}</td></tr>
  </table>
</div>`,
    variables: ["pipelineName", "pipelineId", "recordCount", "completedAt"],
    isSystem: true,
  },
  {
    slug: "pipeline_failure",
    name: "Pipeline Failure Notification",
    description: "Sent to configured recipients when a pipeline run fails.",
    subject: "Pipeline \"{{pipelineName}}\" failed",
    body: `<div style="font-family:sans-serif;max-width:700px">
  <h2 style="color:#dc2626">Pipeline Run Failed</h2>
  <p>Pipeline <strong>{{pipelineName}}</strong> (ID: {{pipelineId}}) encountered an error.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;width:140px">Pipeline</td>
        <td style="padding:8px;border:1px solid #e5e7eb">{{pipelineName}} (ID: {{pipelineId}})</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Consecutive Failures</td>
        <td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626">{{failures}}</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Time (IST)</td>
        <td style="padding:8px;border:1px solid #e5e7eb">{{timestamp}}</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Error</td>
        <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;font-size:13px;color:#dc2626">{{errorMessage}}</td></tr>
  </table>
  <p style="color:#374151"><strong>Functional impact:</strong> Data transfer was not completed. Downstream systems may have stale or missing data. Please investigate the pipeline configuration.</p>
</div>`,
    variables: ["pipelineName", "pipelineId", "failures", "errorMessage", "timestamp"],
    isSystem: true,
  },
  {
    slug: "pipeline_failure_admin",
    name: "Pipeline Failure Admin Alert",
    description: "Sent to all Admin users when a pipeline reaches the consecutive failure threshold.",
    subject: "Alert: Pipeline \"{{pipelineName}}\" failed {{failures}} times in a row",
    body: `<div style="font-family:sans-serif;max-width:700px">
  <h2 style="color:#dc2626">Pipeline Failure Alert</h2>
  <p>Pipeline <strong>{{pipelineName}}</strong> (ID: {{pipelineId}}) has failed
     <strong>{{failures}} consecutive time(s)</strong>.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;width:140px">Pipeline</td>
        <td style="padding:8px;border:1px solid #e5e7eb">{{pipelineName}} (ID: {{pipelineId}})</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Failures</td>
        <td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626">{{failures}}</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Time (IST)</td>
        <td style="padding:8px;border:1px solid #e5e7eb">{{timestamp}}</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Error</td>
        <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;font-size:13px;color:#dc2626">{{errorMessage}}</td></tr>
  </table>
  <p style="color:#374151"><strong>Functional impact:</strong> Data transfer was not completed for this run. Please investigate the source connection, query, and destination table configuration.</p>
</div>`,
    variables: ["pipelineName", "pipelineId", "failures", "errorMessage", "timestamp"],
    isSystem: true,
  },
  {
    slug: "smtp_test",
    name: "SMTP Test Email",
    description: "Sent when testing the SMTP configuration.",
    subject: "{{appName}} — SMTP Test",
    body: `<div style="font-family:sans-serif;max-width:500px">
  <p>This is a test email from <strong>{{appName}}</strong>.</p>
  <p>Your SMTP configuration is working correctly.</p>
</div>`,
    variables: ["appName"],
    isSystem: true,
  },
];

/** Idempotently seed system templates that don't yet exist in the DB. */
export async function ensureSystemTemplates(): Promise<void> {
  const existing = await db.select({ slug: emailTemplatesTable.slug }).from(emailTemplatesTable);
  const existingSlugs = new Set(existing.map(r => r.slug));
  const missing = SYSTEM_TEMPLATES.filter(t => !existingSlugs.has(t.slug!));
  if (missing.length > 0) {
    await db.insert(emailTemplatesTable).values(missing);
  }
}

// GET /api/admin/email-templates
router.get("/admin/email-templates", authenticate, requireRole("Admin"), async (_req, res) => {
  await ensureSystemTemplates();
  const rows = await db.select().from(emailTemplatesTable).orderBy(asc(emailTemplatesTable.isSystem), asc(emailTemplatesTable.name));
  res.json(rows);
});

// GET /api/admin/email-templates/:id
router.get("/admin/email-templates/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [row] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(row);
});

// POST /api/admin/email-templates
router.post("/admin/email-templates", authenticate, requireRole("Admin"), async (req, res) => {
  const { name, slug, subject, body, description, variables } = req.body as {
    name: string; slug: string; subject: string; body: string;
    description?: string; variables?: string[];
  };

  if (!name || !slug || !subject || !body) {
    res.status(400).json({ error: "name, slug, subject and body are required" });
    return;
  }

  const slugClean = slug.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const [existing] = await db.select({ id: emailTemplatesTable.id }).from(emailTemplatesTable).where(eq(emailTemplatesTable.slug, slugClean));
  if (existing) { res.status(409).json({ error: "A template with this slug already exists" }); return; }

  const [row] = await db.insert(emailTemplatesTable).values({
    name: name.trim(), slug: slugClean,
    subject: subject.trim(), body: body.trim(),
    description: description?.trim() || null,
    variables: variables ?? [],
    isSystem: false,
  }).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "EMAIL_TEMPLATE_CREATED",
    details: `Created email template: ${name} (slug=${slugClean})`,
    resourceType: "email_template", resourceId: String(row.id), ipAddress: getIp(req),
  });

  res.status(201).json(row);
});

// PUT /api/admin/email-templates/:id
router.put("/admin/email-templates/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [existing] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

  const { name, subject, body, description, variables } = req.body as {
    name?: string; subject?: string; body?: string;
    description?: string; variables?: string[];
  };

  const updates: Partial<typeof emailTemplatesTable.$inferInsert> = { updatedAt: new Date() };
  if (name !== undefined)        updates.name        = name.trim();
  if (subject !== undefined)     updates.subject     = subject.trim();
  if (body !== undefined)        updates.body        = body.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (variables !== undefined)   updates.variables   = variables;

  const [updated] = await db.update(emailTemplatesTable).set(updates).where(eq(emailTemplatesTable.id, id)).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "EMAIL_TEMPLATE_UPDATED",
    details: `Updated email template: ${updated.name} (id=${id})`,
    resourceType: "email_template", resourceId: String(id), ipAddress: getIp(req),
  });

  res.json(updated);
});

// DELETE /api/admin/email-templates/:id
router.delete("/admin/email-templates/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [existing] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Template not found" }); return; }
  if (existing.isSystem) { res.status(400).json({ error: "System templates cannot be deleted" }); return; }

  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "EMAIL_TEMPLATE_DELETED",
    details: `Deleted email template: ${existing.name} (id=${id})`,
    resourceType: "email_template", resourceId: String(id), ipAddress: getIp(req),
  });

  res.status(204).send();
});

// POST /api/admin/email-templates/:id/send-test — send preview to logged-in user's email
router.post("/admin/email-templates/:id/send-test", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [tmpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
  if (!tmpl) { res.status(404).json({ error: "Template not found" }); return; }

  const [smtp] = await db.select().from(smtpSettingsTable).limit(1);
  const appName = smtp?.fromName || "Ashika Platform";

  const sampleVars: Record<string, string> = {
    firstName: req.user!.email.split("@")[0],
    otp: "123456",
    expiryMinutes: "10",
    appName,
    pipelineName: "Sample Pipeline",
    pipelineId: "42",
    recordCount: "1,250",
    completedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    failures: "3",
    errorMessage: "Connection refused — destination host unreachable",
    timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };

  try {
    const subject = renderTemplate(tmpl.subject, sampleVars);
    const html    = renderTemplate(tmpl.body, sampleVars);
    await sendMail(req.user!.email, `[TEST] ${subject}`, html);
    res.json({ success: true, sentTo: req.user!.email });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to send test email: ${msg}` });
  }
});

export { renderTemplate };
export default router;
