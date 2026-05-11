import { pgTable, serial, text, integer, boolean, index } from "drizzle-orm/pg-core";
import { rolesTable } from "./roles";

export const permissionsTable = pgTable("permissions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
});

export const rolePermissionsTable = pgTable(
  "role_permissions",
  {
    id: serial("id").primaryKey(),
    roleId: integer("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissionsTable.id, { onDelete: "cascade" }),
    granted: boolean("granted").notNull().default(true),
  },
  (t) => [index("role_permissions_role_idx").on(t.roleId)]
);
