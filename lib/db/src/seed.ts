import { db } from "./index";
import { rolesTable, usersTable, pagePermissionsTable } from "./schema/index";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

const ROLES = [
  { name: "Admin", description: "Full system access — manage users, roles, configurations" },
  { name: "Manager", description: "View and manage users; cannot change system settings" },
  { name: "Analyst", description: "Access to data workflows and read-only views" },
  { name: "Viewer", description: "Read-only access to permitted pages" },
  { name: "ExternalUser", description: "Limited access for external partners" },
];

const PAGES = [
  { path: "/dashboard", name: "Dashboard" },
  { path: "/users", name: "User Management" },
  { path: "/roles", name: "Role & Permissions" },
  { path: "/profile", name: "My Profile" },
  { path: "/mfa-setup", name: "MFA Setup" },
  { path: "/audit-log", name: "Audit Log" },
  { path: "/docs", name: "API Documentation" },
  { path: "/workflow", name: "Data Workflow" },
  { path: "/admin/app-settings", name: "App Settings" },
  { path: "/admin/email-settings", name: "Email Settings" },
  { path: "/admin/pii-permissions", name: "PII Permissions" },
  { path: "/pii-records", name: "PII Records" },
  { path: "/admin/db-connections", name: "DB Connections" },
  { path: "/admin/field-mappings", name: "Field Mappings" },
];

const ALL_ROLES_PATHS = ["/dashboard", "/profile", "/mfa-setup"];

const PAGE_ACCESS: Record<string, string[]> = {
  Admin: [...ALL_ROLES_PATHS, "/users", "/roles", "/audit-log", "/docs", "/workflow", "/pii-records", "/admin/app-settings", "/admin/email-settings", "/admin/pii-permissions", "/admin/db-connections", "/admin/field-mappings"],
  Manager: [...ALL_ROLES_PATHS, "/docs", "/workflow", "/pii-records"],
  Analyst: [...ALL_ROLES_PATHS, "/docs", "/workflow", "/pii-records"],
  Viewer: [...ALL_ROLES_PATHS, "/docs", "/pii-records"],
  ExternalUser: [...ALL_ROLES_PATHS, "/docs"],
};

const USERS = [
  { email: "sachin.bansode@ashikagroup.com", firstName: "Sachin", lastName: "Bansode", role: "Admin", password: "Admin@123456" },
  { email: "priya.sharma@ashikagroup.com", firstName: "Priya", lastName: "Sharma", role: "Manager", password: "Manager@123456" },
  { email: "rahul.mehta@ashikagroup.com", firstName: "Rahul", lastName: "Mehta", role: "Analyst", password: "Analyst@123456" },
  { email: "deepa.nair@ashikagroup.com", firstName: "Deepa", lastName: "Nair", role: "Viewer", password: "Viewer@123456" },
  { email: "arjun.patel@ashikagroup.com", firstName: "Arjun", lastName: "Patel", role: "Analyst", password: "Analyst@123456" },
  { email: "james.wilson@externalpartner.com", firstName: "James", lastName: "Wilson", role: "ExternalUser", password: "External@123456" },
];

async function seed() {
  console.log("Seeding roles...");
  const roleMap: Record<string, number> = {};
  for (const role of ROLES) {
    const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.name, role.name));
    if (existing) {
      roleMap[role.name] = existing.id;
      console.log(`  Role ${role.name} already exists (id=${existing.id})`);
    } else {
      const [inserted] = await db.insert(rolesTable).values(role).returning({ id: rolesTable.id });
      roleMap[role.name] = inserted!.id;
      console.log(`  Created role ${role.name} (id=${inserted!.id})`);
    }
  }

  console.log("Seeding page permissions...");
  for (const [roleName, allowedPaths] of Object.entries(PAGE_ACCESS)) {
    const roleId = roleMap[roleName];
    if (!roleId) continue;
    for (const page of PAGES) {
      const canAccess = allowedPaths.includes(page.path);
      await db
        .insert(pagePermissionsTable)
        .values({ roleId, pagePath: page.path, pageName: page.name, canAccess })
        .onConflictDoUpdate({
          target: [pagePermissionsTable.roleId, pagePermissionsTable.pagePath],
          set: { canAccess },
        });
    }
    console.log(`  Seeded permissions for ${roleName}`);
  }

  console.log("Seeding users...");
  for (const user of USERS) {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, user.email));
    if (existing) {
      console.log(`  User ${user.email} already exists`);
      continue;
    }
    const roleId = roleMap[user.role];
    if (!roleId) {
      console.log(`  Role ${user.role} not found for ${user.email}`);
      continue;
    }
    const passwordHash = await bcrypt.hash(user.password, SALT_ROUNDS);
    await db.insert(usersTable).values({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleId,
      passwordHash,
      authProvider: "local",
      isActive: true,
      mfaEnabled: false,
    });
    console.log(`  Created user ${user.email} (${user.role})`);
  }

  console.log("\nSeed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
