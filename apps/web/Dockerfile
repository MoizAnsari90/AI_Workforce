FROM node:22-bookworm-slim AS builder
WORKDIR /app
ARG API_URL=http://api:3001
ENV API_URL=$API_URL
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci
COPY packages/shared ./packages/shared/
COPY apps/web ./apps/web/
RUN mkdir -p apps/web/public apps/web/node_modules && npm run build --workspace=@ai-employee/shared && npm run build --workspace=@ai-employee/web
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/packages/shared ./packages/shared
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npm", "start"]