import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  rolesTable,
  piiFieldPermissionsTable,
  piiRecordsTable,
  PII_FIELD_TYPES,
} from "@workspace/db";
import { authenticate, requireRole, requirePageAccess } from "../middlewares/authenticate";
import { encrypt, decrypt, loadEncryptionKey, updateCachedKey } from "../lib/crypto";

const router: IRouter = Router();

const MASKED = "••••••••";

const FIELD_MAP: Record<string, keyof typeof piiRecordsTable.$inferSelect> = {
  phone: "phone",
  nationalId: "nationalId",
  bankAccount: "bankAccount",
  panNumber: "panNumber",
  emailCounterparty: "emailCounterparty",
  address: "address",
};

const FIELD_TYPE_MAP: Record<string, string> = {
  phone: "phone",
  nationalId: "national_id",
  bankAccount: "bank_account",
  panNumber: "pan_number",
  emailCounterparty: "email_counterparty",
  address: "address",
};

const PII_FIELDS = ["phone", "nationalId", "bankAccount", "panNumber", "emailCounterparty", "address"] as const;

const HEX_64 = /^[0-9a-fA-F]{64}$/;

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

// Per-user rate limit: 20 reveals per 60-second window
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

// GET /pii/records — paginated list, all PII fields masked
router.get("/pii/records", authenticate, requirePageAccess("/pii-records"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 20);
  const offset = (page - 1) * pageSize;

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(piiRecordsTable);
  const records = await db.select().from(piiRecordsTable).limit(pageSize).offset(offset);

  res.json({ records: records.map(maskRecord), total: countRow.count, page, pageSize });
});

// GET /pii/my-permissions — field types the caller's role may unmask
router.get("/pii/my-permissions", authenticate, requirePageAccess("/pii-records"), async (req, res) => {
  const roleId = req.user!.roleId;
  const perms = await db
    .select({ fieldType: piiFieldPermissionsTable.fieldType, canUnmask: piiFieldPermissionsTable.canUnmask })
    .from(piiFieldPermissionsTable)
    .where(eq(piiFieldPermissionsTable.roleId, roleId));

  res.json({ allowedFieldTypes: perms.filter(p => p.canUnmask).map(p => p.fieldType) });
});

// POST /pii/records — create new PII record; all sensitive fields AES-256-GCM encrypted
router.post("/pii/records", authenticate, requirePageAccess("/pii-records"), requireRole("Admin"), async (req, res) => {
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

// DELETE /pii/records/:id — hard delete with audit event
router.delete("/pii/records/:id", authenticate, requirePageAccess("/pii-records"), requireRole("Admin"), async (req, res) => {
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

// POST /pii/reveal — decrypt a single field after RBAC + rate-limit checks
router.post("/pii/reveal", authenticate, requirePageAccess("/pii-records"), async (req, res) => {
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

// GET /pii/field-permissions — role × field unmask matrix
router.get("/pii/field-permissions", authenticate, requireRole("Admin"), async (_req, res) => {
  const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable).orderBy(rolesTable.id);
  const perms = await db.select().from(piiFieldPermissionsTable);

  res.json({
    fieldTypes: [...PII_FIELD_TYPES],
    roles,
    permissions: perms.map(p => ({ roleId: p.roleId, fieldType: p.fieldType, canUnmask: p.canUnmask })),
  });
});

// PUT /pii/field-permissions — upsert role × field grants
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

// POST /pii/rotate-key — re-encrypts all records with newKey; only updates in-memory key
// after full successful rotation. Admin must update PII_ENCRYPTION_KEY secret before restart.
router.post("/pii/rotate-key", authenticate, requireRole("Admin"), async (req, res) => {
  const { newKey } = req.body as { newKey?: string };

  if (!newKey || !HEX_64.test(newKey)) {
    res.status(400).json({ error: "newKey must be exactly 64 hexadecimal characters (32-byte AES-256 key)." });
    return;
  }

  await loadEncryptionKey();

  // Validate new key with a round-trip before touching any records
  try {
    decrypt(encrypt("validation-probe", newKey), newKey);
  } catch {
    res.status(400).json({ error: "newKey failed round-trip validation — key may be malformed." });
    return;
  }

  const records = await db.select().from(piiRecordsTable);
  let rotated = 0;

  // Re-encrypt every record; any crypto failure aborts the entire rotation
  for (const record of records) {
    const updates: Partial<typeof piiRecordsTable.$inferInsert> = {};
    let changed = false;

    for (const field of PII_FIELDS) {
      const val = record[field as keyof typeof record] as string | null;
      if (!val) continue;
      const plain = decrypt(val);
      (updates as Record<string, string>)[field] = encrypt(plain, newKey);
      changed = true;
    }

    if (changed) {
      await db.update(piiRecordsTable).set(updates).where(eq(piiRecordsTable.id, record.id));
      rotated++;
    }
  }

  // Cache updated only after all records have been successfully re-encrypted
  updateCachedKey(newKey);

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "PII_KEY_ROTATED",
    details: `Re-encrypted ${rotated} PII record(s) with new key`,
    resourceType: "pii_encryption_key",
    ipAddress: req.ip ?? null,
  });

  res.json({
    rotated,
    success: true,
    message: `Re-encrypted ${rotated} record(s). ACTION REQUIRED: Update the PII_ENCRYPTION_KEY Replit Secret before the next server restart.`,
  });
});

export default router;
