# OrderHub Web — build context = repo root (monorepo pnpm)
# build:  docker build -f apps/web/Dockerfile -t orderhub-web .
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# ---- build ----
FROM base AS build
ARG VITE_API_URL=http://localhost:3000/api
ENV VITE_API_URL=$VITE_API_URL
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile
COPY apps/web ./apps/web
RUN pnpm --filter web build

# ---- runtime (nginx serve estático) ----
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
