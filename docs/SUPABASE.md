# Supabase — setup (Auth)

Usamos o Supabase só para **Auth** (login/JWT). Em dev os dados ficam no Postgres do Docker; o Supabase emite o login. Em produção, o `DATABASE_URL` aponta pro Postgres do Supabase.

## Passo a passo (painel)

1. Cria conta em **https://supabase.com** (login com GitHub).
2. **New project**
   - Name: `order-hub`
   - Region: **South America (São Paulo)**
   - Database password: defina e **anote** (usada se for apontar o banco pro Supabase em prod).
3. Espera ~2 min provisionar.
4. **Project Settings → API** — copie:
   - **Project URL** → ex: `https://abcd.supabase.co`
   - **anon public** key → front
   - **service_role** key → segredo (cole no `.env` da API, **nunca** em chat/commit)
5. **Authentication → Providers → Email**:
   - garanta que **Email** está habilitado;
   - **desligue "Confirm email"** (em dev, pra logar sem clicar link).
6. (Depois, ao publicar o front) **Authentication → URL Configuration**: adicione a URL do site e redirects.

## Valores nos `.env`

### `apps/api/.env`
```
SUPABASE_URL=https://abcd.supabase.co
SUPABASE_ANON_KEY=<anon public>
# DATABASE_URL continua no Docker local em dev
```

### `apps/web/.env`
```
VITE_SUPABASE_URL=https://abcd.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public>
VITE_API_URL=http://localhost:3000/api
```

## Como a auth funciona aqui

1. Front loga via `@supabase/supabase-js` (email+senha) → recebe **JWT**.
2. Front manda `Authorization: Bearer <jwt>` em toda chamada à API.
3. API valida o JWT (chama `auth.getUser` no Supabase; cache curto) → extrai `id`+email.
4. API faz **upsert** em `app_user` no 1º acesso (espelha o usuário do Auth).
5. Tudo é escopado por `owner_id` = id do usuário logado.

> Otimização futura: validar o JWT localmente via JWKS (sem chamada de rede). Por ora, `getUser` é mais simples e à prova de erro.
