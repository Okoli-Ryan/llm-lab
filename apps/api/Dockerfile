# syntax=docker/dockerfile:1
# Build from the repo root (pnpm needs the root lockfile):
#   docker build -f apps/api/Dockerfile -t llm-lab-api .
# Multi-stage: compile in throwaway stages, ship only the runtime stage.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# Install all dependencies. Manifests are copied first so this layer is cached
# until package.json or the lockfile changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter api...

# Compile TypeScript to dist/.
FROM deps AS build
COPY apps/api/ apps/api/
RUN pnpm --filter api build

# Production dependencies only (no TypeScript, tsx, drizzle-kit, @types).
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter api...

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# Keep the /repo/apps/api layout: pnpm's node_modules are symlinks into /repo/node_modules.
WORKDIR /repo/apps/api
COPY --from=prod-deps --chown=node:node /repo/node_modules /repo/node_modules
COPY --from=prod-deps --chown=node:node /repo/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --chown=node:node apps/api/package.json ./

USER node
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so node is PID 1 and receives SIGTERM for graceful shutdown.
CMD ["node", "--enable-source-maps", "dist/server.js"]
