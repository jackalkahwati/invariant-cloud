/**
 * Fixture App — Basic Auth Module
 *
 * Simple JWT-based authentication. No SSO, no roles, no audit.
 * The benchmark will extend this with SSO and role enforcement.
 *
 * NOTE: This file is intentionally shared by multiple benchmark tasks:
 * - sso-middleware modifies it to add SSO integration
 * - audit-middleware modifies it to emit audit events
 * - roles-enforcement modifies it to attach role guards
 *
 * This creates the realistic multi-task file contention that the
 * parallel runtime must coordinate.
 */

export interface AuthToken {
  user_id: string;
  email: string;
  role: "user" | "admin" | "superadmin";
  issued_at: number;
  expires_at: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

export async function login(req: LoginRequest): Promise<LoginResponse> {
  // Stub: real impl would check DB
  return {
    token: `jwt.stub.${req.email}`,
    user: {
      id: "user-1",
      email: req.email,
      role: "user",
    },
  };
}

export async function verifyToken(token: string): Promise<AuthToken | null> {
  // Stub: real impl would verify JWT signature
  if (!token.startsWith("jwt.")) return null;

  return {
    user_id: "user-1",
    email: "user@example.com",
    role: "user",
    issued_at: Date.now() - 1000,
    expires_at: Date.now() + 3600 * 1000,
  };
}

export async function register(email: string, password: string): Promise<string> {
  // Returns new user ID
  return `user-${Date.now()}`;
}
