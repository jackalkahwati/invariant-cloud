/**
 * Fixture App — Basic Role Definitions
 * Pre-benchmark state: only three roles, no fine-grained permissions.
 * The AdminRoles benchmark tasks extend this significantly.
 */

export type RoleName = "user" | "admin" | "superadmin";

export interface Role {
  name: RoleName;
  permissions: string[];
  description: string;
}

export const ROLES: Record<RoleName, Role> = {
  user: {
    name: "user",
    permissions: ["read:own_profile", "update:own_profile"],
    description: "Standard authenticated user",
  },
  admin: {
    name: "admin",
    permissions: ["read:all_users", "update:all_users", "read:audit_logs"],
    description: "Administrative user with elevated access",
  },
  superadmin: {
    name: "superadmin",
    permissions: ["*"],
    description: "Full system access",
  },
};

export function hasPermission(role: RoleName, permission: string): boolean {
  const r = ROLES[role];
  if (!r) return false;
  return r.permissions.includes("*") || r.permissions.includes(permission);
}
