# Imagen de la API. El contexto es la raíz del monorepo:
#   docker build -f apps/api/Dockerfile .

# --- Base: Node 22 + pnpm (la versión fijada en packageManager) ---
FROM node:22-alpine AS base
# Los motores de Prisma necesitan OpenSSL
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

# --- Build: instala todo, compila y prepara node_modules solo de producción ---
FROM base AS build
# Primero los manifiestos, para que la capa de dependencias se reutilice si solo cambia el código
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @reservalab/api...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @reservalab/api build

# Copia de la API con solo dependencias de producción; el cliente de Prisma se genera ahí
RUN pnpm --filter @reservalab/api deploy --prod --legacy /prod/api \
 && cd /prod/api && ./node_modules/.bin/prisma generate --schema prisma/schema.prisma

# Recorte de peso (~95 MB): motores WASM de Prisma para runtimes edge y otras bases (en Node se usa
# el motor nativo libquery_engine) y TypeScript, que Prisma declara como peer pero no usa sin prisma.config.ts
RUN cd /prod/api/node_modules/.pnpm \
 && rm -rf @prisma+client@*/node_modules/@prisma/client/runtime/*.wasm* \
           @prisma+client@*/node_modules/@prisma/client/runtime/query_engine_bg.*.js \
           @prisma+client@*/node_modules/@prisma/client/runtime/query_engine_bg.*.mjs \
           @prisma+client@*/node_modules/.prisma/client/*.wasm \
           typescript@*

# --- Imagen final: solo el bundle, el esquema con migraciones y node_modules de producción ---
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /prod/api/node_modules ./node_modules
COPY --from=build --chown=node:node /prod/api/package.json ./
COPY --from=build --chown=node:node /repo/apps/api/prisma ./prisma
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.API_PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Aplica las migraciones pendientes y luego arranca; exec deja a Node como PID 1 para recibir SIGTERM
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && exec node --enable-source-maps dist/server.js"]
