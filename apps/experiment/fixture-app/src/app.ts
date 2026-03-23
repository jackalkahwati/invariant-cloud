/**
 * Fixture App — Express entry point
 *
 * BASE file. Feature tasks DO NOT touch this.
 * integration-wiring mounts feature routes and wires auth here.
 */

import express from "express";
import type { Application } from "express";

export const app: Application = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});
