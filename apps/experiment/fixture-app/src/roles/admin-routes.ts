/**
 * Admin Routes Configuration
 * Feature-local admin routes export for integration-wiring
 */

import { Router } from 'express';
import adminRouter from '../routes/admin.routes';

/**
 * Export admin router for mounting by integration-wiring
 * This module serves as the public API for admin routes
 */
export function getAdminRouter(): Router {
  return adminRouter;
}

export default adminRouter;
