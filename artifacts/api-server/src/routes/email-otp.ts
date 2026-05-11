import { Router, type IRouter } from "express";
import { eq, and, gt } from "drizzle-orm";
import bcrypt from "bcrypt";
import { db, usersTable, rolesTable, emailOtpsTable, pagePermissionsTable, auditLogsTable } from "@workspace/db";
import { sendMail } from "../lib/mailer";
import { signAccessToken, generateRawRefreshToken, hashRefreshToken, getRefreshTokenExpiry } from "../lib/auth";
import { refreshTokensTable, sessionsTable } from "@workspace/db";

const router: IRouter = Router();
const SALT_ROUNDS = 10;
const OTP_EXPIRY_MINUTES = 10;

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function getPagePermissions(roleId: number): Promise<string[]> {
  const perms = await db
    .select({ pagePath: pagePermissionsTable.pagePath })
    .from(pagePermissionsTable)
    .where(and(eq(pagePermissionsTable.roleId, roleId), eq(pagePermissionsTable.canAccess, true)));
  return perms.filter(p => p.pagePath).map(p => p.pagePath);
}

async function issueTokens(userId: number) {
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName, roleId: usersTable.roleId, roleName: rolesTable.name, isActive: usersTable.isActive, mfaEnabled: usersTable.mfaEnabled, authProvider: usersTable.authProvider })
    .from(usersTable)
    .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
    .where(eq(usersTable.id, userId));
  if (!user) throw new Error("User not found");

  const accessToken = signAccessToken({ sub: user.id, email: user.email, roleId: user.roleId, roleName: user.roleName });
  const rawRt = generateRawRefreshToken();
  const hashedRt = hashRefreshToken(rawRt);
  const expiresAt = getRefreshTokenExpiry();
  await db.insert(refreshTokensTable).values({ userId: user.id, token: hashedRt, expiresAt });
  await db.insert(sessionsTable).values({ userId: user.id, refreshTokenHash: hashedRt, expiresAt, isRevoked: false });
  const pagePermissions = await getPagePermissions(user.roleId);
  return { accessToken, refreshToken: rawRt, userId: user.id, user: { ...user, pagePermissions } };
}

// POST /auth/email-otp/send
router.post("/auth/email-otp/send", async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (!user || !user.isActive) {
    // Don't reveal whether email exists — always respond success
    res.json({ success: true, message: "If this email is registered, an OTP has been sent." });
    return;
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Invalidate old unused OTPs for this email
  await db.delete(emailOtpsTable).where(eq(emailOtpsTable.email, email.toLowerCase()));
  await db.insert(emailOtpsTable).values({ email: email.toLowerCase(), otpHash, expiresAt, used: false });

  try {
    await sendMail(
      email,
      "Your Ashika Platform Login OTP",
      `<p>Hello ${user.firstName},</p>
       <p>Your one-time login code is:</p>
       <h2 style="letter-spacing: 8px; font-family: monospace; font-size: 36px; color: #1a1a1a;">${otp}</h2>
       <p>This code expires in <strong>${OTP_EXPIRY_MINUTES} minutes</strong>.</p>
       <p>If you did not request this, please ignore this email.</p>`,
    );

    await db.insert(auditLogsTable).values({
      userId: user.id, userEmail: user.email,
      action: "EMAIL_OTP_SENT", details: `OTP sent to ${email}`, ipAddress: req.ip ?? null,
    });

    res.json({ success: true, message: "If this email is registered, an OTP has been sent." });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to send OTP email: ${msg}` });
  }
});

// POST /auth/email-otp/verify
router.post("/auth/email-otp/verify", async (req, res): Promise<void> => {
  const { email, otp } = req.body as { email?: string; otp?: string };
  if (!email || !otp) {
    res.status(400).json({ error: "email and otp are required" });
    return;
  }

  const now = new Date();
  const [record] = await db
    .select()
    .from(emailOtpsTable)
    .where(and(eq(emailOtpsTable.email, email.toLowerCase()), eq(emailOtpsTable.used, false), gt(emailOtpsTable.expiresAt, now)));

  if (!record) {
    await db.insert(auditLogsTable).values({
      userId: null, userEmail: email,
      action: "EMAIL_OTP_FAILED", details: "Invalid or expired OTP", ipAddress: req.ip ?? null,
    });
    res.status(401).json({ error: "Invalid or expired OTP" });
    return;
  }

  const valid = await bcrypt.compare(otp, record.otpHash);
  if (!valid) {
    await db.insert(auditLogsTable).values({
      userId: null, userEmail: email,
      action: "EMAIL_OTP_FAILED", details: "Incorrect OTP code", ipAddress: req.ip ?? null,
    });
    res.status(401).json({ error: "Invalid or expired OTP" });
    return;
  }

  await db.update(emailOtpsTable).set({ used: true }).where(eq(emailOtpsTable.id, record.id));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Account not found or inactive" });
    return;
  }

  const tokens = await issueTokens(user.id);
  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  await db.insert(auditLogsTable).values({
    userId: user.id, userEmail: user.email,
    action: "EMAIL_OTP_LOGIN", details: "Login via Email OTP", ipAddress: req.ip ?? null,
  });

  res.json(tokens);
});

export default router;
