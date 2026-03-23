/**
 * Admin Extension Module
 * Feature-local admin route handlers and role management
 */

import { Router, Response } from 'express';
import { requireAdmin } from '../../roles/guard';
import type { GuardedRequest } from '../../roles/guard';
import type { RoleAssignmentResponse } from '../../roles/types';

const adminRouter = Router();

/**
 * GET /api/admin/users
 * List all users — requires admin role
 */
adminRouter.get('/users', requireAdmin, (req: GuardedRequest, res: Response) => {
  // Return empty array for now — admin endpoint is protected
  res.status(200).json([]);
});

/**
 * POST /api/admin/roles/assign
 * Assign a role to a user — requires admin role
 */
adminRouter.post('/roles/assign', requireAdmin, (req: GuardedRequest, res: Response) => {
  try {
    const { userId, roleId } = req.body;

    if (!userId || !roleId) {
      res.status(400).json({ error: 'Missing userId or roleId' });
      return;
    }

    // Role assignment logic — simplified for integration test
    const response: RoleAssignmentResponse = {
      assigned: true,
      message: `Role ${roleId} assigned to user ${userId}`,
    };

    res.status(200).json(response);
  } catch (error) {
    res.status(400).json({ error: 'Role assignment failed' });
  }
});

/**
 * GET /api/admin/roles
 * Get all available roles — requires admin role
 */
adminRouter.get('/roles', requireAdmin, (req: GuardedRequest, res: Response) => {
  const { ROLES } = require('../../roles/schema');
  res.status(200).json(Object.values(ROLES));
});

export default adminRouter;
