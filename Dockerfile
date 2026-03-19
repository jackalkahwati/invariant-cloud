# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Workspace manifests first (layer cache)
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY tsconfig.base.json ./
COPY prisma/ ./prisma/

# Install all deps (workspaces)
RUN npm ci --workspace=apps/api

# Generate Prisma client (schema lives at repo root)
RUN cd apps/api && npx prisma generate --schema=../../prisma/schema.prisma

# Source + build
COPY apps/api/src/ ./apps/api/src/
COPY apps/api/tsconfig.json ./apps/api/
RUN cd apps/api && npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY prisma/ ./prisma/

# Production deps only
RUN npm ci --workspace=apps/api --omit=dev

# Prisma client for runtime
RUN cd apps/api && npx prisma generate --schema=../../prisma/schema.prisma

COPY --from=builder /app/apps/api/dist ./apps/api/dist

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "apps/api/dist/main.js"]
