import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, rolesTable, mfaSecretsTable, refreshTokensTable, auditLogsTable, pagePermissionsTable } from "@workspace/db";
import {
  LoginBody,
  RefreshTokenBody,
  VerifyMfaBody,
  ChangePasswordBody,
} from "@workspace/api-zod";
import {
  hashPassword,
  comparePassword,
  signAccessToken,
  signRefreshToken,
  signTempToken,
  verifyToken,
  generateMfaSecret,
  generateMfaQrCode,
  getMfaOtpAuthUrl,
  verifyMfaToken,
  getRefreshTokenExpiry,
} from "../lib/auth";
import { authenticate } from "../middlewares/authenticate";
import crypto from "crypto";

const router: IRouter = Router();

async function getUserWithRole(userId: number) {
  const [row] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      roleId: usersTable.roleId,
      roleName: rolesTable.name,
      isActive: usersTable.isActive,
      mfaEnabled: usersTable.mfaEnabled,
      authProvider: usersTable.authProvider,
      passwordHash: usersTable.passwordHash,
    })
    .from(usersTable)
    .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
    .where(eq(usersTable.id, userId));
  return row;
}

async function getPagePermissions(roleId: number): Promise<string[]> {
  const perms = await db
    .select({ pagePath: pagePermissionsTable.pagePath })
    .from(pagePermissionsTable)
    .where(eq(pagePermissionsTable.roleId, roleId));
  return perms.filter((p) => p.pagePath).map((p) => p.pagePath);
}

async function logAudit(userId: number | null, userEmail: string | null, action: string, details: string | null, ipAddress: string | null) {
  await db.insert(auditLogsTable).values({ userId, userEmail, action, details, ipAddress });
}

// POST /auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      roleId: usersTable.roleId,
      roleName: rolesTable.name,
      isActive: usersTable.isActive,
      mfaEnabled: usersTable.mfaEnabled,
      authProvider: usersTable.authProvider,
      passwordHash: usersTable.passwordHash,
    })
    .from(usersTable)
    .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
    .where(eq(usersTable.email, email.toLowerCase()));

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (user.authProvider === "m365") {
    res.status(401).json({ error: "Please use Microsoft 365 SSO to login" });
    return;
  }

  if (!user.passwordHash) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    await logAudit(user.id, user.email, "LOGIN_FAILED", "Invalid password", req.ip ?? null);
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const tokenPayload = { sub: user.id, email: user.email, roleId: user.roleId, roleName: user.roleName };

  if (user.mfaEnabled) {
    const tempToken = signTempToken(tokenPayload);
    res.json({ requiresMfa: true, tempToken, userId: user.id });
    return;
  }

  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);
  const rawToken = crypto.randomBytes(32).toString("hex");

  await db.insert(refreshTokensTable).values({
    userId: user.id,
    token: rawToken,
    expiresAt: getRefreshTokenExpiry(),
  });

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  await logAudit(user.id, user.email, "LOGIN_SUCCESS", null, req.ip ?? null);

  const pagePermissions = await getPagePermissions(user.roleId);

  res.json({
    requiresMfa: false,
    accessToken,
    refreshToken,
    userId: user.id,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId,
      roleName: user.roleName,
      isActive: user.isActive,
      mfaEnabled: user.mfaEnabled,
      authProvider: user.authProvider,
      pagePermissions,
    },
  });
});

// POST /auth/logout
router.post("/auth/logout", authenticate, async (req, res): Promise<void> => {
  if (req.user) {
    await db
      .delete(refreshTokensTable)
      .where(eq(refreshTokensTable.userId, req.user.sub));
    await logAudit(req.user.sub, req.user.email, "LOGOUT", null, req.ip ?? null);
  }
  res.json({ success: true });
});

// POST /auth/refresh
router.post("/auth/refresh", async (req, res): Promise<void> => {
  const parsed = RefreshTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let payload;
  try {
    payload = verifyToken(parsed.data.refreshToken);
    if (payload.type !== "refresh") throw new Error("wrong type");
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  const user = await getUserWithRole(payload.sub);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "User not found or inactive" });
    return;
  }

  const tokenPayload = { sub: user.id, email: user.email, roleId: user.roleId, roleName: user.roleName };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  const pagePermissions = await getPagePermissions(user.roleId);

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId,
      roleName: user.roleName,
      isActive: user.isActive,
      mfaEnabled: user.mfaEnabled,
      authProvider: user.authProvider,
      pagePermissions,
    },
  });
});

// POST /auth/mfa/setup
router.post("/auth/mfa/setup", authenticate, async (req, res): Promise<void> => {
  const userId = req.user!.sub;
  const secret = generateMfaSecret();

  await db
    .insert(mfaSecretsTable)
    .values({ userId, secret })
    .onConflictDoUpdate({ target: mfaSecretsTable.userId, set: { secret } });

  const user = await getUserWithRole(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const qrCodeUrl = await generateMfaQrCode(user.email, secret);
  const otpauthUrl = getMfaOtpAuthUrl(user.email, secret);

  res.json({ secret, qrCodeUrl, otpauthUrl });
});

// POST /auth/mfa/verify
router.post("/auth/mfa/verify", async (req, res): Promise<void> => {
  const parsed = VerifyMfaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let payload;
  try {
    payload = verifyToken(parsed.data.tempToken);
    if (payload.type !== "temp") throw new Error("wrong type");
  } catch {
    res.status(401).json({ error: "Invalid or expired temporary token" });
    return;
  }

  const [mfaSecret] = await db
    .select()
    .from(mfaSecretsTable)
    .where(eq(mfaSecretsTable.userId, payload.sub));

  if (!mfaSecret) {
    res.status(401).json({ error: "MFA not configured" });
    return;
  }

  const valid = verifyMfaToken(parsed.data.code, mfaSecret.secret);
  if (!valid) {
    res.status(401).json({ error: "Invalid MFA code" });
    return;
  }

  // If MFA was being set up (not yet enabled), enable it now
  await db
    .update(usersTable)
    .set({ mfaEnabled: true, lastLoginAt: new Date() })
    .where(eq(usersTable.id, payload.sub));

  const user = await getUserWithRole(payload.sub);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const tokenPayload = { sub: user.id, email: user.email, roleId: user.roleId, roleName: user.roleName };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  await logAudit(user.id, user.email, "MFA_VERIFIED", null, req.ip ?? null);

  const pagePermissions = await getPagePermissions(user.roleId);

  res.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId,
      roleName: user.roleName,
      isActive: user.isActive,
      mfaEnabled: user.mfaEnabled,
      authProvider: user.authProvider,
      pagePermissions,
    },
  });
});

// POST /auth/mfa/disable
router.post("/auth/mfa/disable", authenticate, async (req, res): Promise<void> => {
  await db
    .update(usersTable)
    .set({ mfaEnabled: false })
    .where(eq(usersTable.id, req.user!.sub));

  await db.delete(mfaSecretsTable).where(eq(mfaSecretsTable.userId, req.user!.sub));
  await logAudit(req.user!.sub, req.user!.email, "MFA_DISABLED", null, req.ip ?? null);

  res.json({ success: true });
});

// GET /auth/me
router.get("/auth/me", authenticate, async (req, res): Promise<void> => {
  const user = await getUserWithRole(req.user!.sub);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "User not found or inactive" });
    return;
  }

  const pagePermissions = await getPagePermissions(user.roleId);

  res.json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleId: user.roleId,
    roleName: user.roleName,
    isActive: user.isActive,
    mfaEnabled: user.mfaEnabled,
    authProvider: user.authProvider,
    pagePermissions,
  });
});

// POST /auth/change-password
router.post("/auth/change-password", authenticate, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const user = await getUserWithRole(req.user!.sub);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (!user.passwordHash) {
    res.status(400).json({ error: "Cannot change password for SSO accounts" });
    return;
  }

  const valid = await comparePassword(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, user.id));
  await logAudit(user.id, user.email, "PASSWORD_CHANGED", null, req.ip ?? null);

  res.json({ success: true });
});

// GET /auth/m365 — redirect to Microsoft
router.get("/auth/m365", async (_req, res): Promise<void> => {
  const tenantId = process.env.AZURE_TENANT_ID ?? "common";
  const clientId = process.env.AZURE_CLIENT_ID ?? "";
  const redirectUri = encodeURIComponent(process.env.AZURE_REDIRECT_URI ?? "");
  const state = crypto.randomBytes(16).toString("hex");
  const scope = encodeURIComponent("openid profile email");
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`;
  res.redirect(url);
});

// GET /auth/m365/callback
router.get("/auth/m365/callback", async (req, res): Promise<void> => {
  const code = req.query.code as string | undefined;
  const frontendBase = process.env.FRONTEND_URL ?? "";

  if (!code) {
    res.redirect(`${frontendBase}/login?error=m365_failed`);
    return;
  }

  try {
    const tenantId = process.env.AZURE_TENANT_ID ?? "common";
    const clientId = process.env.AZURE_CLIENT_ID ?? "";
    const clientSecret = process.env.AZURE_CLIENT_SECRET ?? "";
    const redirectUri = process.env.AZURE_REDIRECT_URI ?? "";

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      }
    );

    if (!tokenRes.ok) {
      throw new Error("Token exchange failed");
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };
    const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const msUser = (await userRes.json()) as {
      id: string;
      mail?: string;
      userPrincipalName?: string;
      givenName?: string;
      surname?: string;
    };

    const email = (msUser.mail ?? msUser.userPrincipalName ?? "").toLowerCase();
    if (!email) throw new Error("No email from M365");

    let [existingUser] = await db
      .select({
        id: usersTable.id,
        roleId: usersTable.roleId,
        roleName: rolesTable.name,
        isActive: usersTable.isActive,
        mfaEnabled: usersTable.mfaEnabled,
        authProvider: usersTable.authProvider,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
      })
      .from(usersTable)
      .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
      .where(eq(usersTable.email, email));

    if (!existingUser) {
      const [viewerRole] = await db.select().from(rolesTable).where(eq(rolesTable.name, "Viewer"));
      const roleId = viewerRole?.id ?? 5;
      const [newUser] = await db
        .insert(usersTable)
        .values({
          email,
          firstName: msUser.givenName ?? "",
          lastName: msUser.surname ?? "",
          roleId,
          authProvider: "m365",
          m365ObjectId: msUser.id,
          isActive: true,
          mfaEnabled: false,
        })
        .returning({
          id: usersTable.id,
          email: usersTable.email,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
          roleId: usersTable.roleId,
          isActive: usersTable.isActive,
          mfaEnabled: usersTable.mfaEnabled,
          authProvider: usersTable.authProvider,
        });

      existingUser = { ...newUser, roleName: "Viewer" };
    }

    if (!existingUser.isActive) {
      res.redirect(`${frontendBase}/login?error=account_disabled`);
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, existingUser.id));
    await logAudit(existingUser.id, existingUser.email, "M365_LOGIN", null, req.ip ?? null);

    const tokenPayload = { sub: existingUser.id, email: existingUser.email, roleId: existingUser.roleId, roleName: existingUser.roleName };
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

    res.redirect(`${frontendBase}/auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`);
  } catch (err) {
    req.log.error({ err }, "M365 callback error");
    res.redirect(`${frontendBase}/login?error=m365_failed`);
  }
});

export default router;
