/**
 * Integration Tests
 * Full end-to-end test suite for feature route aggregation
 */

import request from 'supertest';
import { app } from '../src/app';

describe('Integration Tests', () => {
  describe('Health Check', () => {
    it('GET /api/health should return ok status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.timestamp).toBe('number');
    });
  });

  describe('SSO Routes', () => {
    it('POST /api/auth/sso/callback should return session_id', async () => {
      const res = await request(app)
        .post('/api/auth/sso/callback')
        .send({ samlResponse: 'test-saml-response' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('session_id');
      expect(typeof res.body.session_id).toBe('string');
    });

    it('GET /api/auth/sso/logout should return 200 with logged_out status', async () => {
      const res = await request(app)
        .get('/api/auth/sso/logout')
        .query({ session_id: 'test-session' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('logged_out');
    });

    it('GET /api/auth/sso/verify should return 401 without session_id', async () => {
      const res = await request(app).get('/api/auth/sso/verify');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Audit Routes', () => {
    it('GET /api/audit/logs should return empty array initially', async () => {
      const res = await request(app).get('/api/audit/logs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/audit/logs?limit=5 should respect limit parameter', async () => {
      const res = await request(app)
        .get('/api/audit/logs')
        .query({ limit: 5 });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Admin Routes', () => {
    it('GET /api/admin/users with admin role should return 200', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('x-user-role', 'admin');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/admin/users without admin role should return 403', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(403);
    });

    it('POST /api/admin/roles/assign with admin role should return assigned: true', async () => {
      const res = await request(app)
        .post('/api/admin/roles/assign')
        .set('x-user-role', 'admin')
        .send({ userId: 'user-1', roleId: 'role-1' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('assigned');
      expect(res.body.assigned).toBe(true);
    });

    it('POST /api/admin/roles/assign without admin role should return 403', async () => {
      const res = await request(app)
        .post('/api/admin/roles/assign')
        .send({ userId: 'user-1', roleId: 'role-1' });
      expect(res.status).toBe(403);
    });

    it('GET /api/admin/roles with admin role should return array of roles', async () => {
      const res = await request(app)
        .get('/api/admin/roles')
        .set('x-user-role', 'admin');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
