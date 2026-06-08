// Aplica migrations no Supabase (prod) sem mexer no .env local.
// Fonte da URL (prioridade): $DATABASE_URL_PROD  ->  apps/api/.env.production (DATABASE_URL).
// Use a conexão DIRETA do Supabase (porta 5432), NÃO o pooler 6543 (DDL não roda bem no pgbouncer).
//
//   pnpm --filter api migrate:prod
//   # ou: DATABASE_URL_PROD="postgresql://...:5432/postgres" pnpm --filter api migrate:prod
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '.env.production');

function fromEnvFile() {
  if (!existsSync(envFile)) return undefined;
  for (const raw of readFileSync(envFile, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key !== 'DATABASE_URL') continue;
    return line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const url = process.env.DATABASE_URL_PROD ?? fromEnvFile();
if (!url) {
  console.error(
    'Faltou a URL de prod. Defina DATABASE_URL_PROD ou crie apps/api/.env.production com DATABASE_URL=...',
  );
  process.exit(1);
}
if (url.includes(':6543') || url.includes('pgbouncer')) {
  console.error(
    'Use a conexão DIRETA (5432), não o pooler 6543 — migrate deploy roda DDL.',
  );
  process.exit(1);
}

const host = url.replace(/:\/\/[^@]*@/, '://***@');
console.log(`Aplicando migrations em: ${host}`);

execSync('pnpm exec prisma migrate deploy', {
  cwd: join(here, '..'),
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
});
