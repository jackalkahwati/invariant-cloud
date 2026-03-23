/**
 * Permissions matrix and authorization logic
 */

import { ROLES, ROLE_HIERARCHY } from './schema';

/**
 * Permission matrix defining which roles have which permissions
 */
export const PERMISSIONS_MATRIX: Record<string, Set<string>> = {
  guest: new Set(['read:public']),
  user: new Set([
    'read:public',
    'read:profile',
    'write:own-data',
  ]),
  admin: new Set(
    Object.values(ROLES).find(r => r.name === 'admin')?.permissions || []
  ),
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: string, permission: string): boolean {
  const rolePermissions = PERMISSIONS_MATRIX[role];
  if (!rolePermissions) return false;
  
  // Handle wildcard permissions
  if (permission.includes('*')) {
    const prefix = permission.split('*')[0];
    return Array.from(rolePermissions).some(p => p.startsWith(prefix));
  }
  
  return rolePermissions.has(permission);
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: string): string[] {
  return Array.from(PERMISSIONS_MATRIX[role] || new Set());
}

/**
 * Check if a user role can access admin endpoints
 */
export function isAdmin(role: string): boolean {
  return ROLE_HIERARCHY[role] !== undefined && ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.admin;
}

/**
 * Check if a user role can access audit endpoints
 */
export function canViewAudit(role: string): boolean {
  return hasPermission(role, 'read:audit') || isAdmin(role);
}
