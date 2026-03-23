/**
 * Fixture App — Express entry point
 *
 * BASE file. Feature tasks DO NOT touch this.
 * integration-wiring mounts feature routes and wires auth here.
 */

import express from "express";
import type { Application } from "express";
import ssoRouter from "./auth/sso-routes";
import auditRouter from "./routes/audit.routes";
import adminRouter from "./roles/admin-routes";

export const app: Application = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Mount feature routes
app.use("/api/auth/sso", ssoRouter);
app.use("/api/audit", auditRouter);
app.use("/api/admin", adminRouter);
