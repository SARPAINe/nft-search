# syntax=docker/dockerfile:1.7
#
# Multi-stage build. Uses node:20-slim (debian) rather than -alpine because
# Prisma's prebuilt engine links against libssl.so.* that Alpine lacks.

# ---- deps stage ----
FROM node:20-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install --include=dev && npx prisma generate

# ---- build stage ----
FROM node:20-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---- runtime stage ----
FROM node:20-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app

# Production deps only
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install --omit=dev && npx prisma generate && npm cache clean --force

# Compiled JS + runtime-only assets (migration SQL is shipped for one-off psql use)
COPY --from=build /app/dist ./dist
COPY src/db/migrations ./src/db/migrations

# Drop root
RUN groupadd --system app && useradd --system --gid app --home /app app && chown -R app:app /app
USER app

EXPOSE 4000
# dumb-init forwards signals (SIGTERM) correctly for clean shutdown.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/app.js"]
