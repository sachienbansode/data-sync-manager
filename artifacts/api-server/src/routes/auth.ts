import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, rolesTable, mfaSecretsTable, refreshTokensTable, auditLogsTable, pagePermissionsTable, sessionsTable } from "@workspace/db";
import {
  LoginBody,
  VerifyMfaBody,
  ChangePasswordBody,
} from "@workspace/api-zod";
import {
  hashPassword,
  comparePassword,
  signAccessToken,
  signTempToken,
  verifyToken,
  generateMfaSecret,
  generateMfaQrCode,
  getMfaOtpAuthUrl,
  verifyMfaToken,
  hashRefreshToken,
  generateRawRefreshToken,
  getRefreshTokenExpiry,
} from "../lib/auth";
import { authenticate } from "../middlewares/authenticate";
import crypto from "crypto";

const router: IRouter = Router();

// In-memory store for M365 OAuth state (state → expiry) and one-time SSO codes
const m365StateStore = new Map<string, number>(); // state → expiresAt ms
const ssoOneTimeCodes = new Map<string, { userId: number; expiresAt: number }>(); // code → userId+expiry

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of m365StateStore) if (v < now) m365StateStore.delete(k);
  for (const [k, v] of ssoOneTimeCodes) if (v.expiresAt < now) ssoOneTimeCodes.delete(k);
}, 60_000);

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
    .where(
      and(
        eq(pagePermissionsTable.roleId, roleId),
        eq(pagePermissionsTable.canAccess, true)
      )
    );
  return perms.filter((p) => p.pagePath).map((p) => p.pagePath);
}

async function logAudit(
  userId: number | null,
  userEmail: string | null,
  action: string,
  details: string | null,
  ipAddress: string | null,
) {
  await db.insert(auditLogsTable).values({ userId, userEmail, action, details, ipAddress });
}

async function issueTokens(userId: number) {
  const user = await getUserWithRole(userId);
  if (!user) throw new Error("User not found");

  const tokenPayload = { sub: user.id, email: user.email, roleId: user.roleId, roleName: user.roleName };
  const accessToken = signAccessToken(tokenPayload);

  // Opaque refresh token: store hash in DB, return raw to client
  const rawRefresh = generateRawRefreshToken();
  const hashedRefresh = hashRefreshToken(rawRefresh);
  const expiresAt = getRefreshTokenExpiry();

  await db.insert(refreshTokensTable).values({
    userId: user.id,
    token: hashedRefresh,
    expiresAt,
  });

  // Track session metadata
  await db.insert(sessionsTable).values({
    userId: user.id,
    refreshTokenHash: hashedRefresh,
    expiresAt,
  }).onConflictDoNothing();

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

  const pagePermissions = await getPagePermissions(user.roleId);

  return {
    userId: user.id,
    accessToken,
    refreshToken: rawRefresh, // return raw opaque token
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
  };
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
    await logAudit(user.id, user.email, "LOGIN_MFA_REQUIRED", null, req.ip ?? null);
    res.json({ requiresMfa: true, tempToken, userId: user.id });
    return;
  }

  const tokens = await issueTokens(user.id);
  await logAudit(user.id, user.email, "LOGIN_SUCCESS", null, req.ip ?? null);
  res.json({ requiresMfa: false, ...tokens });
});

// POST /auth/logout
router.post("/auth/logout", authenticate, async (req, res): Promise<void> => {
  if (req.user) {
    await db.delete(refreshTokensTable).where(eq(refreshTokensTable.userId, req.user.sub));
    await db.update(sessionsTable)
      .set({ isRevoked: true })
      .where(eq(sessionsTable.userId, req.user.sub));
    await logAudit(req.user.sub, req.user.email, "LOGOUT", null, req.ip ?? null);
  }
  res.json({ success: true });
});

// POST /auth/refresh — accepts opaque refresh token, validates against DB, rotates
router.post("/auth/refresh", async (req, res): Promise<void> => {
  const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";
  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken is required" });
    return;
  }

  const hashedIncoming = hashRefreshToken(refreshToken);
  const now = new Date();

  const [stored] = await db
    .select()
    .from(refreshTokensTable)
    .where(eq(refreshTokensTable.token, hashedIncoming));

  if (!stored || stored.expiresAt < now) {
    if (stored) await db.delete(refreshTokensTable).where(eq(refreshTokensTable.id, stored.id));
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  const user = await getUserWithRole(stored.userId);
  if (!user || !user.isActive) {
    await db.delete(refreshTokensTable).where(eq(refreshTokensTable.id, stored.id));
    res.status(401).json({ error: "User not found or inactive" });
    return;
  }

  // Rotate: delete old token, issue new; update session last-used timestamp
  await db.delete(refreshTokensTable).where(eq(refreshTokensTable.id, stored.id));
  await db.update(sessionsTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessionsTable.refreshTokenHash, hashedIncoming));
  const tokens = await issueTokens(user.id);

  res.json(tokens);
});

// POST /auth/mfa/setup — generate secret and QR code (requires auth)
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

// POST /auth/mfa/confirm — confirm a TOTP code during setup (requires auth)
// This is for the setup flow where the user is already authenticated.
router.post("/auth/mfa/confirm", authenticate, async (req, res): Promise<void> => {
  const confirmCode = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (confirmCode.length !== 6 || !/^\d{6}$/.test(confirmCode)) {
    res.status(400).json({ error: "A 6-digit code is required" });
    return;
  }

  const [mfaSecret] = await db
    .select()
    .from(mfaSecretsTable)
    .where(eq(mfaSecretsTable.userId, req.user!.sub));

  if (!mfaSecret) {
    res.status(400).json({ error: "MFA setup not initiated. Call /auth/mfa/setup first." });
    return;
  }

  const valid = verifyMfaToken(confirmCode, mfaSecret.secret);
  if (!valid) {
    res.status(401).json({ error: "Invalid verification code" });
    return;
  }

  await db.update(usersTable).set({ mfaEnabled: true }).where(eq(usersTable.id, req.user!.sub));
  await logAudit(req.user!.sub, req.user!.email, "MFA_ENABLED", null, req.ip ?? null);

  res.json({ success: true });
});

// POST /auth/mfa/verify — verify TOTP during login (requires tempToken)
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

  const tokens = await issueTokens(payload.sub);
  await logAudit(payload.sub, tokens.user.email, "MFA_VERIFIED", null, req.ip ?? null);

  res.json({ requiresMfa: false, ...tokens });
});

// POST /auth/mfa/disable
router.post("/auth/mfa/disable", authenticate, async (req, res): Promise<void> => {
  await db.update(usersTable).set({ mfaEnabled: false }).where(eq(usersTable.id, req.user!.sub));
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

// GET /auth/m365 — initiate PKCE flow via msal-node
router.get("/auth/m365", async (req, res): Promise<void> => {
  const clientId = process.env.AZURE_CLIENT_ID;
  const tenantId = process.env.AZURE_TENANT_ID ?? "common";
  const redirectUri = process.env.AZURE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.status(503).json({ error: "Microsoft 365 SSO is not configured" });
    return;
  }

  const { ConfidentialClientApplication, CryptoProvider } = await import("@azure/msal-node");

  const msalApp = new ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret: process.env.AZURE_CLIENT_SECRET ?? "",
    },
  });

  const cryptoProvider = new CryptoProvider();
  const { verifier, challenge } = await cryptoProvider.generatePkceCodes();

  // State carries PKCE verifier (signed) — store server-side for lookup
  const state = crypto.randomBytes(24).toString("hex");
  // Store verifier mapped to state (30 minute TTL)
  m365StateStore.set(`${state}:verifier`, Date.now() + 30 * 60_000);
  // We can't store the verifier in the same map as expiry; use a second map
  (req.app.locals as Record<string, Map<string, string>>).m365Verifiers ??= new Map();
  (req.app.locals as Record<string, Map<string, string>>).m365Verifiers.set(state, verifier);

  const authCodeUrlParams = {
    scopes: ["openid", "profile", "email"],
    redirectUri,
    codeChallenge: challenge,
    codeChallengeMethod: "S256" as const,
    state,
  };

  const authUrl = await msalApp.getAuthCodeUrl(authCodeUrlParams);
  res.redirect(authUrl);
});

// GET /auth/m365/callback
router.get("/auth/m365/callback", async (req, res): Promise<void> => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const frontendBase = process.env.FRONTEND_URL ?? "";

  if (!code || !state) {
    res.redirect(`${frontendBase}/login?error=m365_failed`);
    return;
  }

  const verifierMap = (req.app.locals as Record<string, Map<string, string>>).m365Verifiers;
  const verifier = verifierMap?.get(state);
  const stateExpiry = m365StateStore.get(`${state}:verifier`);
  // Enforce state TTL + purge both verifier and expiry entry on use
  if (!verifier || !stateExpiry || stateExpiry < Date.now()) {
    verifierMap?.delete(state);
    m365StateStore.delete(`${state}:verifier`);
    res.redirect(`${frontendBase}/login?error=m365_state_invalid`);
    return;
  }
  verifierMap.delete(state);
  m365StateStore.delete(`${state}:verifier`);

  const clientId = process.env.AZURE_CLIENT_ID ?? "";
  const tenantId = process.env.AZURE_TENANT_ID ?? "common";
  const redirectUri = process.env.AZURE_REDIRECT_URI ?? "";

  try {
    const { ConfidentialClientApplication } = await import("@azure/msal-node");
    const msalApp = new ConfidentialClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET ?? "",
      },
    });

    const tokenResult = await msalApp.acquireTokenByCode({
      code,
      scopes: ["openid", "profile", "email"],
      redirectUri,
      codeVerifier: verifier,
    });

    if (!tokenResult) throw new Error("No token result");

    const email = (tokenResult.account?.username ?? "").toLowerCase();
    const firstName = (tokenResult.idTokenClaims as Record<string, string>)?.given_name ?? "";
    const lastName = (tokenResult.idTokenClaims as Record<string, string>)?.family_name ?? "";
    const m365ObjectId = tokenResult.account?.localAccountId ?? "";

    if (!email) throw new Error("No email from M365");

    let [existingUser] = await db
      .select({
        id: usersTable.id,
        roleId: usersTable.roleId,
        isActive: usersTable.isActive,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email));

    if (!existingUser) {
      const [viewerRole] = await db.select().from(rolesTable).where(eq(rolesTable.name, "Viewer"));
      const roleId = viewerRole?.id ?? 4;
      const [newUser] = await db
        .insert(usersTable)
        .values({
          email,
          firstName,
          lastName,
          roleId,
          authProvider: "m365",
          m365ObjectId,
          isActive: true,
          mfaEnabled: false,
        })
        .returning({ id: usersTable.id, roleId: usersTable.roleId, isActive: usersTable.isActive, email: usersTable.email });

      existingUser = newUser!;
    }

    if (!existingUser.isActive) {
      res.redirect(`${frontendBase}/login?error=account_disabled`);
      return;
    }

    await logAudit(existingUser.id, existingUser.email, "M365_LOGIN", null, req.ip ?? null);

    // Issue a one-time code to avoid passing tokens in URL
    const oneTimeCode = crypto.randomBytes(24).toString("hex");
    ssoOneTimeCodes.set(oneTimeCode, { userId: existingUser.id, expiresAt: Date.now() + 30_000 });

    res.redirect(`${frontendBase}/auth/callback?code=${oneTimeCode}`);
  } catch (err) {
    req.log.error({ err }, "M365 callback error");
    res.redirect(`${frontendBase}/login?error=m365_failed`);
  }
});

// POST /auth/m365/exchange — exchange one-time SSO code for real tokens
router.post("/auth/m365/exchange", async (req, res): Promise<void> => {
  const ssoCode = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!ssoCode) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  const entry = ssoOneTimeCodes.get(ssoCode);
  if (!entry || entry.expiresAt < Date.now()) {
    ssoOneTimeCodes.delete(ssoCode);
    res.status(401).json({ error: "Invalid or expired SSO code" });
    return;
  }
  ssoOneTimeCodes.delete(ssoCode);

  const user = await getUserWithRole(entry.userId);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "User not found or inactive" });
    return;
  }

  const tokens = await issueTokens(entry.userId);
  res.json({ requiresMfa: false, ...tokens });
});

export default router;
