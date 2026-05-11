import { Router, type IRouter } from "express";
import { db, smtpSettingsTable, auditLogsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { createTransporter } from "../lib/mailer";

const router: IRouter = Router();

// GET /admin/smtp-settings — returns config without exposing full password
router.get("/admin/smtp-settings", authenticate, requireRole("Admin"), async (_req, res): Promise<void> => {
  const [cfg] = await db.select().from(smtpSettingsTable).limit(1);
  if (!cfg) {
    res.json({ id: null, host: "smtp.gmail.com", port: 587, secure: false, username: "", fromName: "Ashika Platform", fromEmail: "", enabled: false, passwordSet: false });
    return;
  }
  const { password: _, ...rest } = cfg;
  res.json({ ...rest, passwordSet: !!_ });
});

// PUT /admin/smtp-settings — upsert config
router.put("/admin/smtp-settings", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { host, port, secure, username, password, fromName, fromEmail, enabled } = req.body as {
    host: string; port: number; secure: boolean; username: string;
    password?: string; fromName: string; fromEmail: string; enabled: boolean;
  };

  if (!host || !port || !username || !fromName) {
    res.status(400).json({ error: "host, port, username, and fromName are required" });
    return;
  }

  const [existing] = await db.select().from(smtpSettingsTable).limit(1);

  if (existing) {
    const updateData: Partial<typeof smtpSettingsTable.$inferInsert> = { host, port, secure, username, fromName, fromEmail, enabled };
    if (password) updateData.password = password;
    await db.update(smtpSettingsTable).set(updateData);
  } else {
    await db.insert(smtpSettingsTable).values({ host, port, secure, username, password: password ?? "", fromName, fromEmail, enabled });
  }

  const user = (req as Express.Request & { user?: { id: number; email: string } }).user;
  await db.insert(auditLogsTable).values({
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    action: "SMTP_SETTINGS_UPDATED",
    details: `SMTP host: ${host}, enabled: ${enabled}`,
    ipAddress: req.ip ?? null,
  });

  res.json({ success: true });
});

// POST /admin/smtp-settings/test — send test email
router.post("/admin/smtp-settings/test", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { to } = req.body as { to?: string };
  const user = (req as Express.Request & { user?: { id: number; email: string } }).user;
  const recipient = to || user?.email;
  if (!recipient) {
    res.status(400).json({ error: "Recipient email is required" });
    return;
  }

  try {
    const { transporter, from } = await createTransporter();
    await transporter.sendMail({
      from,
      to: recipient,
      subject: "Ashika Platform — SMTP Test",
      html: `<p>This is a test email from <strong>Ashika Platform</strong>.</p><p>Your SMTP configuration is working correctly.</p>`,
    });
    res.json({ success: true, message: `Test email sent to ${recipient}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to send test email: ${msg}` });
  }
});

export default router;
