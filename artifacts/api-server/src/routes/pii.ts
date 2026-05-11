import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  rolesTable,
  appSettingsTable,
  piiFieldPermissionsTable,
  piiRecordsTable,
  PII_FIELD_TYPES,
  type PiiFieldType,
} from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { encrypt, decrypt, loadEncryptionKey, updateCachedKey } from "../lib/crypto";

const router: IRouter = Router();

const MASKED = "••••••••";

// Maps camelCase API fieldNames → DB column keys on piiRecordsTable
const FIELD_MAP: Record<string, keyof typeof piiRecordsTable.$inferSelect> = {
  phone: "phone",
  nationalId: "nationalId",
  bankAccount: "bankAccount",
  panNumber: "panNumber",
  emailCounterparty: "emailCounterparty",
  address: "address",
};

// Maps camelCase API fieldNames → DB field_type strings in pii_field_permissions
const FIELD_TYPE_MAP: Record<string, string> = {
  phone: "phone",
  nationalId: "national_id",
  bankAccount: "bank_account",
  panNumber: "pan_number",
  emailCounterparty: "email_counterparty",
  address: "address",
};

function maskRecord(r: typeof piiRecordsTable.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    company: r.company,
    phone: r.phone ? MASKED : null,
    nationalId: r.nationalId ? MASKED : null,
    bankAccount: r.bankAccount ? MASKED : null,
    panNumber: r.panNumber ? MASKED : null,
    emailCounterparty: r.emailCounterparty ? MASKED : null,
    address: r.address ? MASKED : null,
    createdAt: r.createdAt,
  };
}

// ─── Rate limiter: per user, 20 reveals per minute ───────────────────────────
const revealRateLimit = new Map<number, { count: number; resetAt: number }>();
function checkRateLimit(userId: number): boolean {
  const now = Date.now();
  const entry = revealRateLimit.get(userId);
  if (!entry || entry.resetAt < now) {
    revealRateLimit.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of revealRateLimit) if (v.resetAt < now) revealRateLimit.delete(k);
}, 60_000);

// ─── GET /pii/records ─────────────────────────────────────────────────────────
router.get("/pii/records", authenticate, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 20);
  const offset = (page - 1) * pageSize;

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(piiRecordsTable);
  const records = await db.select().from(piiRecordsTable).limit(pageSize).offset(offset);

  res.json({
    records: records.map(maskRecord),
    total: countRow.count,
    page,
    pageSize,
  });
});

// ─── GET /pii/my-permissions — which fields the current user's role can unmask ─
router.get("/pii/my-permissions", authenticate, async (req, res) => {
  const roleId = req.user!.roleId;
  const perms = await db.select({ fieldType: piiFieldPermissionsTable.fieldType, canUnmask: piiFieldPermissionsTable.canUnmask })
    .from(piiFieldPermissionsTable)
    .where(eq(piiFieldPermissionsTable.roleId, roleId));

  const allowed = perms.filter(p => p.canUnmask).map(p => p.fieldType);
  res.json({ allowedFieldTypes: allowed });
});

// ─── POST /pii/records ────────────────────────────────────────────────────────
router.post("/pii/records", authenticate, requireRole("Admin"), async (req, res) => {
  await loadEncryptionKey();

  const { name, company, phone, nationalId, bankAccount, panNumber, emailCounterparty, address } = req.body as {
    name: string; company?: string; phone?: string; nationalId?: string;
    bankAccount?: string; panNumber?: string; emailCounterparty?: string; address?: string;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const encIf = (v?: string) => (v ? encrypt(v) : null);

  const [record] = await db.insert(piiRecordsTable).values({
    name: name.trim(),
    company: company ?? null,
    phone: encIf(phone),
    nationalId: encIf(nationalId),
    bankAccount: encIf(bankAccount),
    panNumber: encIf(panNumber),
    emailCounterparty: encIf(emailCounterparty),
    address: encIf(address),
  }).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "PII_RECORD_CREATED",
    details: `Created PII record for: ${name.trim()}`,
    resourceType: "pii_record",
    resourceId: String(record.id),
    ipAddress: req.ip ?? null,
  });

  res.status(201).json(maskRecord(record));
});

// ─── DELETE /pii/records/:id ──────────────────────────────────────────────────
router.delete("/pii/records/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [existing] = await db.select().from(piiRecordsTable).where(eq(piiRecordsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  await db.delete(piiRecordsTable).where(eq(piiRecordsTable.id, id));
  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "PII_RECORD_DELETED",
    details: `Deleted PII record: ${existing.name} (id=${id})`,
    resourceType: "pii_record",
    resourceId: String(id),
    ipAddress: req.ip ?? null,
  });
  res.status(204).send();
});

// ─── POST /pii/reveal ─────────────────────────────────────────────────────────
router.post("/pii/reveal", authenticate, async (req, res) => {
  const { recordId, fieldName, recordType = "pii_record" } = req.body as {
    recordId: number;
    fieldName: string;
    recordType?: string;
  };
  const userId = req.user!.sub;
  const roleId = req.user!.roleId;

  if (!recordId || !fieldName || !FIELD_MAP[fieldName]) {
    res.status(400).json({ error: "Invalid recordId or fieldName" });
    return;
  }

  if (!checkRateLimit(userId)) {
    res.status(429).json({ error: "Rate limit exceeded. Max 20 reveals per minute." });
    return;
  }

  const dbFieldType = FIELD_TYPE_MAP[fieldName];
  if (!dbFieldType) {
    res.status(400).json({ error: `Unknown fieldName: ${fieldName}` });
    return;
  }

  const [perm] = await db.select().from(piiFieldPermissionsTable).where(
    and(
      eq(piiFieldPermissionsTable.roleId, roleId),
      eq(piiFieldPermissionsTable.fieldType, dbFieldType)
    )
  );

  if (!perm?.canUnmask) {
    res.status(403).json({ error: `Your role does not have permission to reveal the '${fieldName}' field.` });
    return;
  }

  const [record] = await db.select().from(piiRecordsTable).where(eq(piiRecordsTable.id, recordId));
  if (!record) {
    res.status(404).json({ error: "Record not found" });
    return;
  }

  const encryptedValue = record[FIELD_MAP[fieldName] as keyof typeof record] as string | null;
  if (!encryptedValue) {
    res.status(404).json({ error: "Field has no value" });
    return;
  }

  await loadEncryptionKey();
  let plaintext: string;
  try {
    plaintext = decrypt(encryptedValue);
  } catch {
    res.status(500).json({ error: "Decryption failed. Data may be corrupted or key mismatch." });
    return;
  }

  await db.insert(auditLogsTable).values({
    userId,
    userEmail: req.user!.email,
    action: "PII_REVEAL",
    details: `Revealed field '${fieldName}' on ${recordType} id=${recordId} (${record.name})`,
    resourceType: recordType,
    resourceId: String(recordId),
    fieldName,
    ipAddress: req.ip ?? null,
  });

  res.json({ value: plaintext });
});

// ─── GET /pii/field-permissions ───────────────────────────────────────────────
router.get("/pii/field-permissions", authenticate, requireRole("Admin"), async (_req, res) => {
  const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable).orderBy(rolesTable.id);
  const perms = await db.select().from(piiFieldPermissionsTable);

  res.json({
    fieldTypes: [...PII_FIELD_TYPES],
    roles,
    permissions: perms.map(p => ({ roleId: p.roleId, fieldType: p.fieldType, canUnmask: p.canUnmask })),
  });
});

// ─── PUT /pii/field-permissions ───────────────────────────────────────────────
router.put("/pii/field-permissions", authenticate, requireRole("Admin"), async (req, res) => {
  const { permissions } = req.body as {
    permissions: Array<{ roleId: number; fieldType: string; canUnmask: boolean }>;
  };

  if (!Array.isArray(permissions)) {
    res.status(400).json({ error: "permissions must be an array" });
    return;
  }

  for (const p of permissions) {
    await db
      .insert(piiFieldPermissionsTable)
      .values({ roleId: p.roleId, fieldType: p.fieldType, canUnmask: p.canUnmask })
      .onConflictDoUpdate({
        target: [piiFieldPermissionsTable.roleId, piiFieldPermissionsTable.fieldType],
        set: { canUnmask: p.canUnmask, updatedAt: new Date() },
      });
  }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "PII_PERMISSIONS_UPDATED",
    details: `Updated ${permissions.length} PII field permission(s)`,
    resourceType: "pii_field_permissions",
    ipAddress: req.ip ?? null,
  });

  const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable).orderBy(rolesTable.id);
  const updated = await db.select().from(piiFieldPermissionsTable);
  res.json({
    fieldTypes: [...PII_FIELD_TYPES],
    roles,
    permissions: updated.map(p => ({ roleId: p.roleId, fieldType: p.fieldType, canUnmask: p.canUnmask })),
  });
});

// ─── POST /pii/rotate-key ─────────────────────────────────────────────────────
// Re-encrypts all PII records with the new key, then updates the DB-stored key
// and the in-memory cached key so decryption works immediately (no downtime).
router.post("/pii/rotate-key", authenticate, requireRole("Admin"), async (req, res) => {
  const { newKey } = req.body as { newKey?: string };

  if (!newKey || newKey.length !== 64) {
    res.status(400).json({ error: "newKey must be a 64-character hex string (32 bytes AES-256)" });
    return;
  }

  await loadEncryptionKey();
  const records = await db.select().from(piiRecordsTable);
  let rotated = 0;

  const fields = ["phone", "nationalId", "bankAccount", "panNumber", "emailCounterparty", "address"] as const;

  for (const record of records) {
    const updates: Partial<typeof piiRecordsTable.$inferInsert> = {};
    let changed = false;

    for (const field of fields) {
      const val = record[field as keyof typeof record] as string | null;
      if (val) {
        try {
          const plain = decrypt(val);
          (updates as Record<string, string>)[field] = encrypt(plain, newKey);
          changed = true;
        } catch {
          // Skip values that can't be decrypted with current key
        }
      }
    }

    if (changed) {
      await db.update(piiRecordsTable).set(updates).where(eq(piiRecordsTable.id, record.id));
      rotated++;
    }
  }

  // Update DB-stored key so future server restarts also use the new key
  await db.update(appSettingsTable).set({ piiEncryptionKey: newKey });

  // Update in-memory cache immediately — no restart required, no downtime
  updateCachedKey(newKey);

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "PII_KEY_ROTATED",
    details: `Re-encrypted ${rotated} PII record(s) with new key`,
    resourceType: "pii_encryption_key",
    ipAddress: req.ip ?? null,
  });

  res.json({ rotated, success: true });
});

export default router;
