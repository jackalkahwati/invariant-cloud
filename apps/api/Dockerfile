FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --include=dev
RUN npx prisma generate

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY . .

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node --loader tsx src/main.ts"]
