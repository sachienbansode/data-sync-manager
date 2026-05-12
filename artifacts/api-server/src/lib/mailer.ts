import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { eq } from "drizzle-orm";
import { db, smtpSettingsTable, emailTemplatesTable } from "@workspace/db";

export async function getSmtpConfig() {
  const [cfg] = await db.select().from(smtpSettingsTable).limit(1);
  return cfg ?? null;
}

/** Cached transporter — re-created only when SMTP settings change */
let _transporter: Transporter | null = null;
let _configHash = "";
let _from = "";

function hashConfig(cfg: { host: string; port: number; username: string; password: string; fromName: string; fromEmail: string | null }): string {
  return `${cfg.host}:${cfg.port}:${cfg.username}:${cfg.password}:${cfg.fromName}:${cfg.fromEmail ?? ""}`;
}

export async function createTransporter() {
  const cfg = await getSmtpConfig();
  if (!cfg || !cfg.enabled || !cfg.host || !cfg.username || !cfg.password) {
    throw new Error("SMTP is not configured or disabled. Configure it in Admin → Email Settings.");
  }

  const hash = hashConfig(cfg as Parameters<typeof hashConfig>[0]);

  if (_transporter && _configHash === hash) {
    return { transporter: _transporter, from: _from };
  }

  const useSSL = cfg.port === 465;

  _transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: useSSL,
    requireTLS: !useSSL,
    auth: { user: cfg.username, pass: cfg.password },
    tls: { rejectUnauthorized: false },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    socketTimeout: 10000,
    greetingTimeout: 10000,
    connectionTimeout: 10000,
  });

  _from = `"${cfg.fromName}" <${cfg.fromEmail || cfg.username}>`;
  _configHash = hash;

  return { transporter: _transporter, from: _from };
}

/** Invalidate the cached transporter (call after SMTP settings update) */
export function invalidateMailerCache() {
  _transporter = null;
  _configHash = "";
}

export async function sendMail(to: string, subject: string, html: string) {
  const { transporter, from } = await createTransporter();
  await transporter.sendMail({ from, to, subject, html });
}

/** Replace {{variable}} placeholders in a template string. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v !== undefined ? String(v) : `{{${key}}}`;
  });
}

/**
 * Look up an email template by slug, render subject + body with the given
 * variables, then send. Falls back to the provided hardcoded subject/html
 * if the DB template is missing.
 */
export async function sendMailTemplate(
  to: string,
  slug: string,
  vars: Record<string, string | number>,
  fallback: { subject: string; html: string },
): Promise<void> {
  try {
    const [tmpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.slug, slug));
    if (tmpl) {
      const subject = renderTemplate(tmpl.subject, vars);
      const html    = renderTemplate(tmpl.body, vars);
      await sendMail(to, subject, html);
      return;
    }
  } catch {
    // fall through to hardcoded fallback
  }
  await sendMail(to, fallback.subject, fallback.html);
}

/** Return the app name from SMTP settings (used as a template variable). */
export async function getAppName(): Promise<string> {
  try {
    const cfg = await getSmtpConfig();
    return cfg?.fromName || "Ashika Platform";
  } catch {
    return "Ashika Platform";
  }
}
