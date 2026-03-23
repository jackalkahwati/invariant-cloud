/**
 * Role hierarchy and schema definitions
 */

import type { Role } from './types';

/**
 * Define the role hierarchy
 * Higher number = higher privilege
 */
export const ROLE_HIERARCHY: Record<string, number> = {
  guest: 0,
  user: 1,
  admin: 2,
};

/**
 * Predefined roles with their hierarchy and structure
 */
export const ROLES: Record<string, Role> = {
  guest: {
    id: 'guest',
    name: 'guest',
    description: 'Guest user with minimal access',
    permissions: ['read:public'],
    hierarchy: ROLE_HIERARCHY.guest,
  },
  user: {
    id: 'user',
    name: 'user',
    description: 'Standard user with basic access',
    permissions: ['read:public', 'read:profile', 'write:own-data'],
    hierarchy: ROLE_HIERARCHY.user,
  },
  admin: {
    id: 'admin',
    name: 'admin',
    description: 'Administrator with full access',
    permissions: [
      'read:public',
      'read:profile',
      'read:audit',
      'write:own-data',
      'write:users',
      'write:roles',
      'delete:users',
      'admin:*',
    ],
    hierarchy: ROLE_HIERARCHY.admin,
  },
};

/**
 * Check if a user with sourceRole can perform an action requiring targetRole
 */
export function canAssignRole(sourceRole: string, targetRole: string): boolean {
  const sourceHierarchy = ROLE_HIERARCHY[sourceRole] ?? -1;
  const targetHierarchy = ROLE_HIERARCHY[targetRole] ?? -1;
  return sourceHierarchy > targetHierarchy;
}

/**
 * Get all available roles
 */
export function getAllRoles(): Role[] {
  return Object.values(ROLES);
}

/**
 * Get a role by id
 */
export function getRoleById(roleId: string): Role | null {
  return ROLES[roleId] ?? null;
}
