#!/usr/bin/env node
// Run on server: node scripts/reset-admin-password.mjs
// Resets admin@ashikagroup.com password to Admin@1234

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.production manually
try {
  const envFile = readFileSync('/home/ubuntu/ananta-platform/.env.production', 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
  console.log('Loaded .env.production');
} catch {
  console.log('Using existing env vars');
}

const dbUrl = process.env.CUSTOM_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('ERROR: No database URL found in environment');
  process.exit(1);
}

console.log('DB:', dbUrl.replace(/:([^:@]+)@/, ':***@'));

const require = createRequire(import.meta.url);
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const NEW_PASSWORD = process.argv[2] || 'Admin@1234';
const EMAIL = process.argv[3] || 'admin@ashikagroup.com';

console.log(`\nResetting password for: ${EMAIL}`);
console.log(`New password: ${NEW_PASSWORD}`);

const hash = await bcrypt.hash(NEW_PASSWORD, 12);
const client = new Client({ connectionString: dbUrl });

await client.connect();

const result = await client.query(
  `UPDATE users SET password_hash = $1 WHERE LOWER(email) = LOWER($2) RETURNING id, email, is_active`,
  [hash, EMAIL]
);

if (result.rows.length === 0) {
  console.error('\nERROR: User not found:', EMAIL);
  const all = await client.query('SELECT id, email, is_active FROM users LIMIT 10');
  console.log('\nUsers in DB:');
  console.table(all.rows);
} else {
  console.log('\nPassword reset successfully:');
  console.table(result.rows);
  console.log(`\nLogin with: ${EMAIL} / ${NEW_PASSWORD}`);
}

await client.end();
