# Imagen de la web: build de Vite y nginx. El contexto es la raíz del monorepo:
#   docker build -f apps/web/Dockerfile --build-arg VITE_INFO_API_KEY=rl_live_... .

# --- Build: instala solo lo que necesita la web y genera los archivos estáticos ---
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @reservalab/web...

COPY tsconfig.base.json ./
# El build corre tsc, que revisa vitest.config.ts, y este importa el umbral común de cobertura
COPY vitest.coverage.mjs vitest.coverage.d.mts coverage.thresholds.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# La key de la pantalla informativa (solo read:now) queda incrustada en el JavaScript: es pública
ARG VITE_INFO_API_KEY=""
ENV VITE_INFO_API_KEY=$VITE_INFO_API_KEY
RUN pnpm --filter @reservalab/web build

# --- Imagen final: nginx sirve los archivos y reenvía /api a la API ---
FROM nginx:1.28-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
