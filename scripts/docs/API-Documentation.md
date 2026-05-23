# Ananta Platform — API Documentation

**Platform:** Ananta Tech / Ashika Group  
**Backend:** Express 5 + TypeScript  
**Database:** PostgreSQL (Drizzle ORM)  
**Version:** 1.0  
**Base URL (AWS Dev):** `http://<aws-dev-host>/api`

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Users](#2-users)
3. [Roles & Permissions](#3-roles--permissions)
4. [API Keys](#4-api-keys)
5. [Branch Migration (Admin)](#5-branch-migration-admin)
6. [Branch Migration (External API)](#6-branch-migration-external-api)
7. [DB Connections (Admin)](#7-db-connections-admin)
8. [Workflow](#8-workflow)
9. [Pipelines (Admin)](#9-pipelines-admin)
10. [RPA Bots](#10-rpa-bots)
11. [Data Preview (Admin)](#11-data-preview-admin)
12. [Docs / API Registry](#12-docs--api-registry)
13. [URL Shortener](#13-url-shortener)
14. [Email / Comms](#14-email--comms)
15. [Audit & Reports](#15-audit--reports)
16. [Security Reference](#16-security-reference)
17. [Error Codes](#17-error-codes)

---

## 1. Authentication

All protected endpoints require a JWT access token passed as a Bearer token:

```
Authorization: Bearer <access_token>
```

The access token is short-lived. Use the refresh token to obtain a new pair without re-logging in.

---

### POST /auth/login

Authenticate a user with email and password. Returns an access token and refresh token on success.

**Auth required:** No

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "plaintextpassword"
}
```

**Response — no MFA (200):**
```json
{
  "requiresMfa": false,
  "accessToken": "eyJ...",
  "refreshToken": "abc123...",
  "userId": 42,
  "user": {
    "id": 42,
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "roleId": 1,
    "roleName": "Admin",
    "isActive": true,
    "mfaEnabled": false,
    "authProvider": "local",
    "pagePermissions": ["/dashboard", "/ops/branch-migration"]
  }
}
```

**Response — MFA required (200):**
```json
{
  "requiresMfa": true,
  "tempToken": "eyJ...",
  "userId": 42
}
```
Follow up with `POST /auth/mfa/verify` using the `tempToken` and a 6-digit TOTP code.

**Errors:**
| Code | Reason |
|------|--------|
| 400  | Missing or invalid fields |
| 401  | Wrong credentials, inactive account, or M365-only account |

---

### POST /auth/logout

Revokes the current session and all associated refresh tokens.

**Auth required:** Yes

**Response (200):**
```json
{ "success": true }
```

---

### POST /auth/refresh

Exchange a refresh token for a new access token + refresh token pair. The old refresh token is invalidated (rotation).

**Auth required:** No

**Request body:**
```json
{
  "refreshToken": "abc123..."
}
```

**Response (200):**
```json
{
  "userId": 42,
  "accessToken": "eyJ...",
  "refreshToken": "newtoken...",
  "user": { ... }
}
```

**Errors:**
| Code | Reason |
|------|--------|
| 400  | Missing refreshToken |
| 401  | Expired, invalid, or revoked token |

---

### GET /auth/me

Returns the authenticated user's profile and page permissions.

**Auth required:** Yes

**Response (200):**
```json
{
  "id": 42,
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "roleId": 1,
  "roleName": "Admin",
  "isActive": true,
  "mfaEnabled": false,
  "authProvider": "local",
  "pagePermissions": ["/dashboard", "/ops/branch-migration"]
}
```

---

### POST /auth/change-password

Change the authenticated user's password.

**Auth required:** Yes

**Request body:**
```json
{
  "currentPassword": "oldpassword",
  "newPassword": "NewPass@1234"
}
```

**Response (200):**
```json
{ "success": true }
```

---

### MFA Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/mfa/setup` | Generate MFA secret + QR code |
| POST | `/auth/mfa/confirm` | Confirm setup with `{ "code": "123456" }` |
| POST | `/auth/mfa/verify` | Verify during login — `{ "tempToken": "...", "code": "123456" }` |
| POST | `/auth/mfa/disable` | Disable MFA for current user |

---

### Microsoft 365 SSO

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/auth/m365` | Redirect to M365 OAuth login |
| GET  | `/auth/m365/callback` | M365 OAuth callback (handled by browser) |
| POST | `/auth/m365/exchange` | Exchange SSO one-time code for tokens — `{ "code": "..." }` |

---

## 2. Users

**Auth required:** Yes (Admin role)

### GET /users

List users with optional filtering and pagination.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| search | string | Filter by name or email |
| roleId | number | Filter by role |
| isActive | boolean | Filter by active status |
| page | number | Page number (default: 1) |
| pageSize | number | Records per page (default: 20) |

**Response (200):**
```json
{
  "users": [ { "id": 1, "email": "...", "firstName": "...", "lastName": "...", "roleName": "Admin", "isActive": true } ],
  "total": 100,
  "page": 1,
  "pageSize": 20
}
```

---

### POST /users

Create a new user.

**Request body:**
```json
{
  "email": "newuser@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "roleId": 2,
  "password": "Temp@1234",
  "authProvider": "local"
}
```

---

### PATCH /users/:id

Update a user's details.

**Request body (all optional):**
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "roleId": 3,
  "password": "NewPass@1234"
}
```

---

### DELETE /users/:id — `204 No Content`

### PATCH /users/:id/status — Toggle active: `{ "isActive": false }`

### PATCH /users/:id/role — Change role: `{ "roleId": 3 }`

### POST /users/:id/reset-mfa — Force-reset MFA for a user

---

## 3. Roles & Permissions

**Auth required:** Yes (Admin role)

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/roles` | List all roles with user counts |
| POST | `/roles` | Create role — `{ "name": "Analyst" }` |
| GET  | `/roles/:id/page-permissions` | List page access for a role |
| PUT  | `/roles/:id/page-permissions` | Bulk-update page access |

**Update page permissions body:**
```json
{
  "permissions": [
    { "pagePath": "/dashboard", "canAccess": true },
    { "pagePath": "/ops/branch-migration", "canAccess": false }
  ]
}
```

---

## 4. API Keys

API keys are used to authenticate external (machine-to-machine) API calls without a user login session. Keys follow the format `apk_...` and are only shown in full **once** at creation.

**Auth required:** Yes (any authenticated user)

### GET /api-keys

List your own API keys (key hashes are never returned).

**Response:**
```json
[
  {
    "id": 1,
    "name": "My Integration Key",
    "keyPrefix": "apk_abc1",
    "isActive": true,
    "lastUsedAt": "2025-05-20T10:30:00Z",
    "expiresAt": null,
    "createdAt": "2025-05-01T09:00:00Z"
  }
]
```

---

### POST /api-keys

Generate a new API key.

**Request body:**
```json
{
  "name": "My Integration Key",
  "expiresAt": null
}
```

**Response (200):**
```json
{
  "id": 1,
  "name": "My Integration Key",
  "key": "apk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "keyPrefix": "apk_xxxx",
  "isActive": true
}
```

> **Important:** The full `key` value is only returned once. Store it securely.

---

### PATCH /api-keys/:id/toggle — Enable or disable a key

### DELETE /api-keys/:id — Permanently delete a key

---

**Using an API key in requests:**

Option A — Authorization header:
```
Authorization: Bearer apk_xxxxxxxxxxxxxxxx
```

Option B — Custom header:
```
X-Api-Key: apk_xxxxxxxxxxxxxxxx
```

---

## 5. Branch Migration (Admin)

Full CRUD for branch migration records.

**Auth required:** Yes (Admin)

### GET /admin/branch-migration

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| search | string | Search by branch code or name |
| status | string | Filter by migration status |
| page | number | Page number |
| pageSize | number | Records per page |

**Response:**
```json
{
  "data": [
    {
      "branchcode": "MUM001",
      "branchname": "Mumbai Main",
      "defaultcode": "DEF001",
      "email": "mumbai@example.com",
      "address1": "123 Main St",
      "ccity": "Mumbai",
      "npincode": "400001",
      "migrationStatus": "completed",
      "migrationDate": "2025-11-15",
      "updatedDatetime": "2025-05-20T12:00:00Z"
    }
  ],
  "total": 50,
  "page": 1,
  "pageSize": 20
}
```

---

### POST /admin/branch-migration

**Request body:**
```json
{
  "branchcode": "MUM001",
  "branchname": "Mumbai Main",
  "defaultcode": "DEF001",
  "email": "mumbai@example.com",
  "address1": "123 Main St",
  "ccity": "Mumbai",
  "npincode": "400001",
  "migrationStatus": "pending",
  "migrationDate": "2025-12-01"
}
```

> `branchcode` and `branchname` are **required**. All other fields are optional.

---

### PUT /admin/branch-migration/:branchcode

Update an existing record. `branchname` is required; all other fields optional.

---

### DELETE /admin/branch-migration/:branchcode

Response: `{ "ok": true }`

---

## 6. Branch Migration (External API)

Designed for machine-to-machine integration. Uses API key authentication — no user session required.

**Auth required:** API Key (`X-Api-Key` or `Authorization: Bearer apk_...`)

### GET /v1/branch-migration

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| branchcode | string | Filter by branch code (optional) |

**Example:**
```bash
curl -H "X-Api-Key: apk_xxxxxxxxxxxxxxxx" \
  "http://<aws-dev-host>/api/v1/branch-migration?branchcode=MUM001"
```

**Response (200):**
```json
[
  {
    "branch_code": "MUM001",
    "branch_name": "Mumbai Main",
    "migration_status": "completed"
  }
]
```

**Errors:**
| Code | Reason |
|------|--------|
| 401  | Missing or invalid API key |
| 403  | Key is inactive or expired |

---

## 7. DB Connections (Admin)

Manage registered database connections (PostgreSQL, MySQL, MS SQL, Oracle, AWS S3, etc.).

**Auth required:** Yes (Admin)

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/admin/db-connections` | List all connections |
| POST   | `/admin/db-connections` | Create connection |
| PUT    | `/admin/db-connections/:id` | Update connection |
| DELETE | `/admin/db-connections/:id` | Delete connection |
| POST   | `/admin/db-connections/:id/test` | Test connectivity |
| GET    | `/admin/db-connections/:id/tables` | List tables |
| GET    | `/admin/db-connections/:id/runs` | Run history |
| GET    | `/admin/aws-regions` | List supported AWS regions |

**Create/update body:**
```json
{
  "name": "Production MySQL",
  "type": "source",
  "dbEngine": "mysql",
  "host": "db.example.com",
  "port": 3306,
  "dbName": "mydb",
  "username": "dbuser",
  "password": "dbpassword",
  "extraParams": { "ssl": "true" }
}
```

**Test response:**
```json
{
  "success": true,
  "message": "MySQL connection successful",
  "steps": [
    { "name": "Network Reachability", "status": "success", "detail": "Host is reachable on port 3306" },
    { "name": "SSL Auto-Retry",       "status": "info",    "detail": "Server requires SSL — retrying with verification disabled" },
    { "name": "Authentication",       "status": "success", "detail": "Connected as \"dbuser\" — SSL enabled automatically" },
    { "name": "Query Test",           "status": "success", "detail": "SELECT 1 executed successfully" }
  ]
}
```

> **SSL note:** If the MySQL server uses a self-signed certificate, the platform automatically retries with verification disabled and saves `ssl: true` on the connection for future use.

---

## 8. Workflow

Data ingestion and transformation jobs.

**Auth required:** Yes

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/workflow/connections` | List available source/destination connections |
| GET  | `/workflow/field-mappings` | Get field mapping configuration |
| PUT  | `/workflow/field-mappings` | Update field mappings |
| GET  | `/workflow/jobs` | List all jobs (paginated) |
| GET  | `/workflow/jobs/:id` | Job details and data preview |
| POST | `/workflow/fetch` | Trigger data fetch — `{ "connectionId": 1 }` |
| POST | `/workflow/upload-csv` | Upload pipe-delimited CSV (multipart) |
| POST | `/workflow/jobs/:id/download` | Download output file |
| POST | `/workflow/jobs/:id/push` | Push output to destination |

---

## 9. Pipelines (Admin)

Automated data pipeline scheduling and execution.

**Auth required:** Yes (Admin)

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/admin/pipelines` | List all pipelines |
| POST   | `/admin/pipelines` | Create pipeline |
| PUT    | `/admin/pipelines/:id` | Update pipeline |
| GET    | `/admin/pipelines/:id/mappings` | Get field mappings |
| PUT    | `/admin/pipelines/:id/mappings` | Update field mappings |
| GET    | `/admin/pipelines/:id/source-columns` | Columns from source DB |
| GET    | `/admin/pipelines/:id/dest-columns` | Columns from destination DB |
| POST   | `/admin/pipelines/:id/run` | Trigger pipeline run |
| GET    | `/admin/pipelines/:id/progress` | Live run progress |
| GET    | `/admin/pipelines/:id/runs` | Run history |

**Create pipeline body:**
```json
{
  "name": "Customer Sync",
  "sourceObjectId": 1,
  "destObjectId": 2,
  "scheduleEnabled": true,
  "scheduleCron": "0 2 * * *",
  "loadType": "full"
}
```

---

## 10. RPA Bots

Browser automation bots with step-by-step configuration and live log streaming.

**Auth required:** Yes

### Bot Management

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/rpa/bots` | List bots with schedules |
| POST   | `/rpa/bots` | Create bot |
| PATCH  | `/rpa/bots/:id` | Update bot |
| DELETE | `/rpa/bots/:id` | Delete bot |

**Create/update body:**
```json
{
  "name": "Daily Report Bot",
  "description": "Generates daily reports",
  "botType": "web",
  "notifyEmail": "admin@example.com",
  "notifyOn": "failure"
}
```

---

### Bot Steps

| Method | Path | Description |
|--------|------|-------------|
| GET | `/rpa/bots/:id/steps` | List steps |
| POST | `/rpa/bots/:id/steps` | Add single step |
| PUT | `/rpa/bots/:id/steps` | Bulk replace all steps |
| PUT | `/rpa/bots/:id/steps/reorder` | Reorder — `{ "order": [3,1,2] }` |

---

### Bot Credentials & Execution

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/rpa/bots/:id/credentials` | List credential labels |
| POST | `/rpa/bots/:id/credentials` | Add encrypted credentials |
| GET  | `/rpa/bots/:id/runs` | Run history |
| POST | `/rpa/bots/:id/run` | Trigger manual run |
| GET  | `/rpa/runs/:id/logs` | Detailed execution logs |
| GET  | `/rpa/runs/:id/stream` | Live log stream (Server-Sent Events) |

**SSE stream usage:**
```javascript
const source = new EventSource('/api/rpa/runs/1/stream', {
  headers: { Authorization: `Bearer ${token}` }
});
source.onmessage = (e) => console.log(e.data);
```

---

## 11. Data Preview (Admin)

Run read-only SQL queries against registered connections. Sensitive fields are automatically masked.

**Auth required:** Yes (Admin)

### POST /admin/data-preview

```json
{
  "connectionId": 1,
  "query": "SELECT * FROM customers LIMIT 10"
}
```

### GET /admin/connection-objects — List reusable table/query objects

### POST /admin/connection-objects/:id/preview — Preview data from a saved object

---

## 12. Docs / API Registry

Register and browse internal API specifications.

**Auth required:** Yes

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/docs/apps` | List registered API apps |
| POST   | `/docs/apps` | Register app (Admin) |
| PATCH  | `/docs/apps/:id` | Update app (Admin) |
| DELETE | `/docs/apps/:id` | Delete app (Admin) |
| GET    | `/docs/apps/:id/specs` | List spec versions |
| POST   | `/docs/apps/:id/specs` | Upload spec (file, URL, or raw content) |
| GET    | `/docs/apps/:id/specs/:version` | Download spec content |
| GET    | `/docs/apps/:id/rbac` | List role access |
| PUT    | `/docs/apps/:id/rbac` | Set role access — `{ "roleIds": [1, 2] }` |
| GET    | `/docs/apps/:id/attachments` | List supporting docs |

---

## 13. URL Shortener

**Auth required:** Yes

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/short-urls` | List all short URLs |
| POST | `/short-urls` | Create short URL |
| GET  | `/short-urls/:id/analytics` | Click statistics |
| GET  | `/short-domains` | List verified custom domains |
| POST | `/short-domains` | Add domain — `{ "domain": "go.example.com" }` |
| POST | `/short-domains/:id/verify` | Trigger DNS TXT verification |

**Create short URL body:**
```json
{
  "originalUrl": "https://very-long-url.example.com/path",
  "customCode": "mylink",
  "domainId": null,
  "startDate": null,
  "endDate": null
}
```

---

## 14. Email / Comms

**Auth required:** Yes (Admin for settings; page permission for templates)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/comm-settings` | Get Netcore API config |
| PUT | `/admin/comm-settings` | Update API keys and sender details |
| GET | `/comm/templates` | List email templates |
| POST | `/comm/templates` | Create template |
| GET | `/comm/templates/:id` | Get template |
| PUT | `/comm/templates/:id` | Update template |
| DELETE | `/comm/templates/:id` | Delete template |
| GET | `/comm/templates/:id/versions` | Version history |
| POST | `/comm/templates/:id/preview` | Render with sample data |

**Create template body:**
```json
{
  "name": "Welcome Email",
  "subject": "Welcome to Ananta Platform",
  "htmlBody": "<h1>Welcome {{firstName}}!</h1>",
  "textBody": "Welcome {{firstName}}!"
}
```

---

## 15. Audit & Reports

**Auth required:** Yes (Admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/login-report` | Login history, success/failure counts |
| GET | `/admin/application-types` | System application categories |
| POST | `/admin/application-types` | Create category |
| PUT | `/admin/application-types/:id` | Update category |
| DELETE | `/admin/application-types/:id` | Delete category |

---

## 16. Security Reference

### Password Hashing
User passwords are hashed with **bcrypt** (10 salt rounds). Plain text passwords are sent in the login request — the API handles hashing internally. Never pre-hash before sending.

### Access Tokens
- Format: **JWT** (RS256 or HS256)
- Short-lived (minutes to hours)
- Passed as `Authorization: Bearer <token>`

### Refresh Tokens
- Format: **Opaque random string** (stored as SHA-256 hash in DB)
- Longer-lived
- Rotated on every use — old token is invalidated immediately
- Invalidated on logout

### API Keys
- Format: `apk_<random>`
- Stored as **SHA-256** hash — full key shown only once at creation
- Pass via `Authorization: Bearer apk_...` or `X-Api-Key: apk_...`
- Can be enabled/disabled/deleted at any time

### Credential Encryption (DB Connections)
- DB passwords stored encrypted with **AES-256** using `PII_ENCRYPTION_KEY`
- If `PII_ENCRYPTION_KEY` changes on the server, saved passwords must be re-entered

---

## 17. Error Codes

| Code | Meaning |
|------|---------|
| 200  | Success |
| 204  | Success — no content (DELETE) |
| 400  | Bad request — validation error, missing fields |
| 401  | Unauthenticated — missing, invalid, or expired token/API key |
| 403  | Forbidden — valid token but insufficient role/permission |
| 404  | Resource not found |
| 409  | Conflict — duplicate record |
| 500  | Internal server error |

**Error response format:**
```json
{
  "error": "Human-readable error message"
}
```

---

*Documentation generated: May 2026 | Ananta Tech Platform v1.0*
