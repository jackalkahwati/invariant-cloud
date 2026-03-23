/**
 * Fixture App — Route Registry
 *
 * Central route registration. Multiple benchmark tasks will add routes here:
 * - sso-routes: adds /auth/sso/*
 * - audit-routes: adds /audit/*
 * - admin-routes: adds /admin/*
 * - integration-wiring: wires everything together
 *
 * This file is a shared write target, making it a key conflict surface
 * for the parallel runtime to manage.
 */

import { login, register } from "./auth/auth.js";

export type Handler = (
  req: Record<string, unknown>,
  res: { status: (code: number) => { json: (body: unknown) => void } }
) => Promise<void>;

export interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  handler: Handler;
  middleware?: string[];
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/health",
    handler: async (_req, res) => res.status(200).json({ ok: true }),
  },
  {
    method: "POST",
    path: "/auth/login",
    handler: async (req, res) => {
      const body = req["body"] as { email: string; password: string };
      const result = await login({ email: body.email, password: body.password });
      res.status(200).json(result);
    },
  },
  {
    method: "POST",
    path: "/auth/register",
    handler: async (req, res) => {
      const body = req["body"] as { email: string; password: string };
      const id = await register(body.email, body.password);
      res.status(201).json({ id });
    },
  },
];

// Routes added by benchmark tasks will be appended here:
// - /auth/sso/callback (sso-routes task)
// - /auth/sso/initiate (sso-routes task)
// - /audit/events (audit-routes task)
// - /audit/search (audit-routes task)
// - /admin/users (admin-routes task)
// - /admin/roles (admin-routes task)
