import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { authConfig } from '../../../infrastructure/config.js';
import { sendWelcomeEmail } from '../../../application/services/EmailService.js';

/** Generate a new API key: inv_<12 random hex chars> */
function generateRawApiKey(): string {
  return 'inv_' + crypto.randomBytes(24).toString('hex');
}

/** Hash an API key for storage */
async function hashApiKey(raw: string): Promise<string> {
  return bcrypt.hash(raw, 10);
}

/** Sign a JWT for a user */
function signToken(userId: string): string {
  return jwt.sign({ userId }, authConfig.jwtSecret, { expiresIn: authConfig.jwtExpiresIn as string });
}

/** Slugify a name */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Ensure workspace slug is unique */
async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base);
  let suffix = 0;
  while (await prisma.workspace.findUnique({ where: { slug } })) {
    suffix++;
    slug = slugify(base) + '-' + suffix;
  }
  return slug;
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/register
  app.post<{
    Body: { email: string; password: string; name?: string; workspaceName?: string }
  }>('/auth/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register a new user and workspace',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:         { type: 'string', format: 'email' },
          password:      { type: 'string', minLength: 8 },
          name:          { type: 'string' },
          workspaceName: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password, name, workspaceName } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.status(409).send({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const wName = workspaceName ?? (name ? `${name}'s Workspace` : 'My Workspace');

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: wName,
        slug: await uniqueSlug(wName),
        members: {
          create: { userId: user.id, role: 'OWNER' },
        },
      },
    });

    // Generate API key
    const rawKey = generateRawApiKey();
    const keyHash = await hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);

    await prisma.workspaceApiKey.create({
      data: {
        workspaceId: workspace.id,
        name: 'Default',
        keyPrefix,
        keyHash,
      },
    });

    // Send welcome email (non-blocking)
    sendWelcomeEmail(email, rawKey, wName).catch(() => {});

    const token = signToken(user.id);

    return reply.status(201).send({
      token,
      apiKey: rawKey,  // returned ONCE — not stored in plaintext
      user:  { id: user.id, email: user.email, name: user.name },
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, tier: workspace.tier },
    });
  });

  // POST /auth/login
  app.post<{
    Body: { email: string; password: string }
  }>('/auth/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login with email and password',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
    });

    const token = signToken(user.id);

    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      workspace: membership?.workspace
        ? { id: membership.workspace.id, name: membership.workspace.name, slug: membership.workspace.slug, tier: membership.workspace.tier }
        : null,
    });
  });

  // GET /auth/me
  app.get('/auth/me', {
    schema: { tags: ['Auth'], summary: 'Get current user and workspace' },
  }, async (req, reply) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing Bearer token' });
    }
    const token = authHeader.slice(7);
    let payload: { userId: string };
    try {
      payload = jwt.verify(token, authConfig.jwtSecret) as { userId: string };
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        workspaces: {
          include: {
            workspace: {
              include: { apiKeys: { where: { isActive: true }, select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true } } },
            },
          },
        },
      },
    });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    return reply.send({ user: { id: user.id, email: user.email, name: user.name }, workspaces: user.workspaces });
  });
}
