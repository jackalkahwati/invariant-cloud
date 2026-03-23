/**
 * Fixture App — User Management
 */

export interface User {
  id: string;
  email: string;
  role: "user" | "admin" | "superadmin";
  created_at: Date;
  sso_provider?: string;   // Added by SSO task
  sso_subject?: string;    // Added by SSO task
  last_login?: Date;
}

const users_db = new Map<string, User>();

export async function getUser(id: string): Promise<User | null> {
  return users_db.get(id) ?? null;
}

export async function listUsers(): Promise<User[]> {
  return Array.from(users_db.values());
}

export async function createUser(email: string, role: User["role"] = "user"): Promise<User> {
  const user: User = {
    id: `user-${Date.now()}`,
    email,
    role,
    created_at: new Date(),
  };
  users_db.set(user.id, user);
  return user;
}

export async function updateUser(id: string, update: Partial<User>): Promise<User | null> {
  const user = users_db.get(id);
  if (!user) return null;
  const updated = { ...user, ...update };
  users_db.set(id, updated);
  return updated;
}

export async function deleteUser(id: string): Promise<boolean> {
  return users_db.delete(id);
}
