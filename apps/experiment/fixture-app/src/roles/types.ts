/**
 * Role types and role-related interfaces
 */

export type RoleType = 'admin' | 'user' | 'guest';

export interface Role {
  id: string;
  name: RoleType;
  description: string;
  permissions: string[];
  hierarchy: number;
}

export interface RoleAssignment {
  userId: string;
  roleId: string;
  assignedAt: Date;
  assignedBy?: string;
}

export interface RoleAssignmentRequest {
  userId: string;
  roleId: string;
}

export interface RoleAssignmentResponse {
  assigned: boolean;
  message?: string;
}
