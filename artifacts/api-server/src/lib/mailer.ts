import nodemailer from "nodemailer";
import { db, smtpSettingsTable } from "@workspace/db";

export async function getSmtpConfig() {
  const [cfg] = await db.select().from(smtpSettingsTable).limit(1);
  return cfg ?? null;
}

export async function createTransporter() {
  const cfg = await getSmtpConfig();
  if (!cfg || !cfg.enabled || !cfg.host || !cfg.username || !cfg.password) {
    throw new Error("SMTP is not configured or disabled. Configure it in Admin → Email Settings.");
  }

  // Port 465 = implicit SSL (secure: true)
  // Port 587 / 25 = STARTTLS (secure: false, requireTLS: true)
  const useSSL = cfg.port === 465;

  return {
    transporter: nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: useSSL,
      requireTLS: !useSSL,
      auth: { user: cfg.username, pass: cfg.password },
      tls: { rejectUnauthorized: false },
    }),
    from: `"${cfg.fromName}" <${cfg.fromEmail || cfg.username}>`,
  };
}

export async function sendMail(to: string, subject: string, html: string) {
  const { transporter, from } = await createTransporter();
  await transporter.sendMail({ from, to, subject, html });
}
