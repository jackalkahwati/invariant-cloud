/**
 * Routes Configuration
 * Central re-export of all feature routers for app integration
 */

import ssoRouter from './auth/sso-routes';
import auditRouter from './routes/audit.routes';
import adminRouter from './roles/admin-routes';

export { ssoRouter, auditRouter, adminRouter };
