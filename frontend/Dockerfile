# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS builder
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Load settings into this process, outside Next's project directory.
# Never COPY the environment file or pass the secret key through ARG/ENV.
RUN --mount=type=secret,id=frontend_env,required=true \
    node docker/build.mjs

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN mkdir -p .next && chown node:node .next
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node docker/healthcheck.mjs ./healthcheck.mjs

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=8s --start-period=15s --retries=5 CMD ["node", "/app/healthcheck.mjs"]
CMD ["node", "server.js"]
