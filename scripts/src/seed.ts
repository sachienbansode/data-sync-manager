import { db, rolesTable, pagePermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/* ─────────────────────────────────────────────────────────────────────────── */
/* Roles                                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */
const ROLES = [
  { name: "Admin",        description: "Full system access — manage users, roles, configurations" },
  { name: "Manager",      description: "View and manage users; cannot change system settings" },
  { name: "Analyst",      description: "Access to data workflows and read-only views" },
  { name: "Viewer",       description: "Read-only access to permitted pages" },
  { name: "ExternalUser", description: "Limited access for external partners" },
];

/* ─────────────────────────────────────────────────────────────────────────── */
/* Pages  — kept in sync with ALL_PAGES in api-server/src/routes/roles.ts      */
/* ─────────────────────────────────────────────────────────────────────────── */
const PAGES = [
  { path: "/dashboard",                name: "Dashboard" },
  { path: "/users",                    name: "Users" },
  { path: "/roles",                    name: "Roles & Permissions" },
  { path: "/audit-log",                name: "Audit Log" },
  { path: "/admin/login-report",       name: "Login Report" },
  { path: "/admin/data-objects",       name: "Data Objects" },
  { path: "/workflow",                 name: "Data Workflow" },
  { path: "/workflow/jobs",            name: "Workflow Jobs" },
  { path: "/admin/db-connections",     name: "DB Connections" },
  { path: "/admin/field-mappings",     name: "Field Mappings" },
  { path: "/admin/email-settings",     name: "Email Settings" },
  { path: "/admin/app-settings",       name: "App Settings" },
  { path: "/admin/font-settings",      name: "Font Settings" },
  { path: "/admin/allowed-file-types", name: "Allowed File Types" },
  { path: "/admin/pii-permissions",    name: "PII Permissions" },
  { path: "/pii-records",              name: "PII Records" },
  { path: "/admin/application-types",  name: "Application Types" },
  { path: "/admin/email-templates",    name: "Email Templates" },
  { path: "/docs",                     name: "API Documentation" },
  { path: "/url-shortener",            name: "URL Shortener" },
  { path: "/admin/short-domains",      name: "Short Domains" },
  { path: "/email-hub/campaigns",      name: "Email Campaigns" },
  { path: "/email-hub/templates",      name: "Email Templates (Bulk)" },
  { path: "/admin/comm-settings",      name: "Bulk Email Settings" },
  { path: "/admin/rpa-bots",           name: "RPA Bot Manager" },
];

/* ─────────────────────────────────────────────────────────────────────────── */
/* Permission matrix  (true = role can access that page)                        */
/* ─────────────────────────────────────────────────────────────────────────── */
const ALL_PATHS = PAGES.map(p => p.path);

const PAGE_ACCESS: Record<string, string[]> = {
  Admin: ALL_PATHS,   // Admin gets everything

  Manager: [
    "/dashboard",
    "/workflow",
    "/workflow/jobs",
    "/docs",
    "/pii-records",
    "/url-shortener",
    "/email-hub/campaigns",
    "/email-hub/templates",
  ],

  Analyst: [
    "/dashboard",
    "/workflow",
    "/workflow/jobs",
    "/docs",
    "/pii-records",
  ],

  Viewer: [
    "/dashboard",
    "/docs",
    "/pii-records",
  ],

  ExternalUser: [
    "/dashboard",
    "/docs",
  ],
};

/* ─────────────────────────────────────────────────────────────────────────── */
/* Seed                                                                         */
/* ─────────────────────────────────────────────────────────────────────────── */
async function seed() {
  console.log("── Seeding roles ──────────────────────────────────────────────");
  const roleMap: Record<string, number> = {};

  for (const role of ROLES) {
    const [existing] = await db
      .select({ id: rolesTable.id })
      .from(rolesTable)
      .where(eq(rolesTable.name, role.name));

    if (existing) {
      roleMap[role.name] = existing.id;
      console.log(`  SKIP  ${role.name} (id=${existing.id}) — already exists`);
    } else {
      const [inserted] = await db
        .insert(rolesTable)
        .values(role)
        .returning({ id: rolesTable.id });
      roleMap[role.name] = inserted!.id;
      console.log(`  CREATE ${role.name} (id=${inserted!.id})`);
    }
  }

  console.log("\n── Seeding page permissions ───────────────────────────────────");
  for (const [roleName, allowedPaths] of Object.entries(PAGE_ACCESS)) {
    const roleId = roleMap[roleName];
    if (!roleId) { console.log(`  WARN  role "${roleName}" not found — skipping`); continue; }

    let granted = 0, denied = 0;
    for (const page of PAGES) {
      const canAccess = allowedPaths.includes(page.path);
      await db
        .insert(pagePermissionsTable)
        .values({ roleId, pagePath: page.path, pageName: page.name, canAccess })
        .onConflictDoUpdate({
          target: [pagePermissionsTable.roleId, pagePermissionsTable.pagePath],
          set: { pageName: page.name, canAccess },
        });
      canAccess ? granted++ : denied++;
    }
    console.log(`  ${roleName.padEnd(12)} granted=${granted}  denied=${denied}`);
  }

  console.log("\n✓ Seed complete — users skipped (manage via the app).");
  process.exit(0);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
