# OrderHub

Gestão de pedidos multi-loja. Monorepo pnpm: **API** (NestJS + Prisma 7) · **Web** (React + Vite) · **Postgres** (Supabase em prod, Docker local).

Modelagem e decisões: [`docs/PLANO.md`](docs/PLANO.md) · [`docs/schema.sql`](docs/schema.sql) · [`docs/FLUXOS.md`](docs/FLUXOS.md).

## Estrutura
```
apps/api   NestJS + Prisma (dono do banco)
apps/web   React + Vite + TS
docs/      modelagem e fluxos
docker-compose.yml  db + api + web
```

## Pré-requisitos
- Node 20+ · pnpm (via `corepack enable`) · Docker

## Subir o banco (local)
```bash
cp .env.example .env          # ajuste se quiser
docker compose up -d db       # Postgres em localhost:5434
```

## Dev (sem Docker, hot reload)
```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm --filter api exec prisma migrate dev   # aplica schema
pnpm dev:api                  # API em http://localhost:3000/api
pnpm dev:web                  # Web em http://localhost:5173
```
Health check: `curl http://localhost:3000/api/health` → `{"status":"ok","db":"up"}`.

## Tudo via Docker
```bash
docker compose up --build     # db + api(:3000) + web(:8080)
```

## Testes (SQLite)
Os testes rodam em **SQLite** — um `schema.test.prisma` é derivado automaticamente do `schema.prisma` (`scripts/gen-test-schema.mjs`: enums→String, tipos Postgres removidos, Decimal→Float).
```bash
pnpm --filter api test        # pretest gera schema + db push, depois jest
```

## Banco
- Migrations: `apps/api/prisma/migrations/`
- Schema: `apps/api/prisma/schema.prisma` (12 tabelas, 9 enums)
- Porta Postgres no host: `5434` (configurável via `DB_PORT`)
