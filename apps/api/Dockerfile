FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

FROM manifests AS builder
RUN npm ci --ignore-scripts
COPY packages/shared ./packages/shared/
COPY apps/api ./apps/api/
COPY scripts ./scripts/
RUN mkdir -p apps/api/node_modules && npm rebuild @prisma/engines && npm run build --workspace=@ai-employee/shared && npm run prisma:generate --workspace=@ai-employee/api && npm run build --workspace=@ai-employee/api

FROM manifests AS production-deps
RUN npm ci --omit=dev --omit=optional --ignore-scripts --workspace=@ai-employee/api --workspace=@ai-employee/shared && node -e "const fs=require('fs'); for (const name of ['typescript','prisma','next','vitest','tsx']) if (fs.existsSync('node_modules/'+name)) throw new Error('Unexpected development tooling: '+name)" && mkdir -p apps/api/node_modules

# Only the one-shot migration image includes the Prisma CLI; serving images omit it.
FROM production-deps AS migration-deps
RUN npm install --omit=dev --ignore-scripts --save-prod --workspace=@ai-employee/api prisma@6.4.1

FROM base AS migration
ENV NODE_ENV=production
COPY --from=migration-deps /app/package.json /app/package-lock.json ./
COPY --from=migration-deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=migration-deps /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/scripts/run-migrations.cjs ./scripts/run-migrations.cjs
USER node
WORKDIR /app/apps/api
CMD ["node", "/app/scripts/run-migrations.cjs"]

# Keep the API server as the default target for existing Compose/docker build users.
FROM base AS runner
ENV NODE_ENV=production PORT=8080
COPY --from=production-deps /app/package.json /app/package-lock.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/production-config.cjs ./packages/shared/production-config.cjs
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
USER node
WORKDIR /app/apps/api
EXPOSE 8080
CMD ["node", "dist/index.js"]
