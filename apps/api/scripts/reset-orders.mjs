/**
 * Zera TODOS os pedidos e dados derivados, mantendo usuários, lojas,
 * produtos, categorias e clientes.
 *
 * O que apaga (numa transação, respeitando FKs):
 *   order_item_option, payment, delivery, order_event,
 *   stock_movement (só os ligados a venda / order_item),
 *   product_history (só os ligados a order_item),
 *   order_item, order
 *
 * Efeitos colaterais (decisões confirmadas):
 *   - Estoque: RESTAURADO. product.stock = soma dos movimentos restantes
 *     (só produtos que controlam estoque; stock NULL fica NULL).
 *   - Resumo do cliente: total_orders=0, total_spent=0, last_order_at=NULL.
 *   - Numeração: sequence de order.code REINICIA em 1.
 *
 * Alvo do banco (prioridade):
 *   --local              -> DATABASE_URL do .env (para teste)
 *   padrão (PROD)        -> $DATABASE_URL_PROD  ->  .env.production (DATABASE_URL)
 *   Use a conexão DIRETA (porta 5432), NÃO o pooler 6543 (pgbouncer).
 *
 * Flags:
 *   --dry-run   conta o que seria afetado e NÃO altera nada
 *   --yes       pula a confirmação interativa
 *   --local     usa o banco local do .env
 *
 * Uso:
 *   node scripts/reset-orders.mjs --local --dry-run     # teste seguro
 *   node scripts/reset-orders.mjs --dry-run             # dry-run em PROD
 *   node scripts/reset-orders.mjs                       # PROD (pede confirmação)
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as readline from 'node:readline/promises';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

// pg é dependência transitiva (via @prisma/adapter-pg). Resolve do store pnpm.
function loadPgClient() {
  try {
    return require('pg').Client;
  } catch {
    const store = join(repoRoot, 'node_modules', '.pnpm');
    const dir = readdirSync(store).find((d) => /^pg@\d/.test(d));
    if (!dir) throw new Error('pacote "pg" não encontrado no node_modules.');
    return require(join(store, dir, 'node_modules', 'pg')).Client;
  }
}

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const YES = args.has('--yes');
const LOCAL = args.has('--local');

function fromEnvFile(file, key) {
  if (!existsSync(file)) return undefined;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    return line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return undefined;
}

function resolveUrl() {
  if (LOCAL) {
    const url =
      process.env.DATABASE_URL ??
      fromEnvFile(join(here, '..', '.env'), 'DATABASE_URL');
    if (!url) {
      console.error('Faltou DATABASE_URL (.env local).');
      process.exit(1);
    }
    return { url, label: 'LOCAL (.env)' };
  }
  const url =
    process.env.DATABASE_URL_PROD ??
    fromEnvFile(join(here, '..', '.env.production'), 'DATABASE_URL');
  if (!url) {
    console.error(
      'Faltou a URL de prod. Defina DATABASE_URL_PROD ou crie apps/api/.env.production com DATABASE_URL=...',
    );
    process.exit(1);
  }
  return { url, label: 'PRODUÇÃO' };
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(url não parseável)';
  }
}

async function main() {
  const { url, label } = resolveUrl();

  if (url.includes(':6543') || url.includes('pgbouncer')) {
    console.error(
      'URL aponta para o pooler (6543/pgbouncer). Use a conexão DIRETA (5432): DDL e cargas grandes não rodam bem no pooler.',
    );
    process.exit(1);
  }

  const Client = loadPgClient();
  const client = new Client({ connectionString: url });
  await client.connect();

  const count = async (sql) => Number((await client.query(sql)).rows[0].n);

  const counts = {
    orders: await count('SELECT COUNT(*)::int n FROM "order"'),
    order_items: await count('SELECT COUNT(*)::int n FROM order_item'),
    payments: await count('SELECT COUNT(*)::int n FROM payment'),
    deliveries: await count('SELECT COUNT(*)::int n FROM delivery'),
    order_events: await count('SELECT COUNT(*)::int n FROM order_event'),
    item_options: await count('SELECT COUNT(*)::int n FROM order_item_option'),
    sale_stock_moves: await count(
      'SELECT COUNT(*)::int n FROM stock_movement WHERE order_item_id IS NOT NULL',
    ),
    sale_history: await count(
      'SELECT COUNT(*)::int n FROM product_history WHERE order_item_id IS NOT NULL',
    ),
    customers: await count('SELECT COUNT(*)::int n FROM customer'),
  };

  console.log(`\nAlvo: ${label}  ->  ${hostOf(url)}`);
  console.log('Será apagado / ajustado:');
  console.log(`  pedidos (order)................. ${counts.orders}`);
  console.log(`  itens (order_item)............. ${counts.order_items}`);
  console.log(`  pagamentos (payment)........... ${counts.payments}`);
  console.log(`  entregas (delivery)............ ${counts.deliveries}`);
  console.log(`  eventos (order_event).......... ${counts.order_events}`);
  console.log(`  opções item (order_item_option) ${counts.item_options}`);
  console.log(
    `  mov. estoque de venda.......... ${counts.sale_stock_moves}  (deletados; estoque recalculado)`,
  );
  console.log(`  histórico de venda............. ${counts.sale_history}`);
  console.log(`  clientes com resumo zerado..... ${counts.customers}`);
  console.log('  + product.stock recalculado, order.code reinicia em 1\n');

  if (DRY) {
    console.log('DRY-RUN: nada foi alterado.');
    await client.end();
    return;
  }

  if (counts.orders === 0) {
    console.log('Não há pedidos. Nada a fazer.');
    await client.end();
    return;
  }

  if (!YES) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ans = await rl.question(
      `Confirma zerar pedidos em ${label} (${hostOf(url)})? Digite SIM: `,
    );
    rl.close();
    if (ans.trim() !== 'SIM') {
      console.log('Cancelado.');
      await client.end();
      return;
    }
  }

  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM order_item_option');
    await client.query('DELETE FROM payment');
    await client.query('DELETE FROM delivery');
    await client.query('DELETE FROM order_event');
    await client.query('DELETE FROM stock_movement WHERE order_item_id IS NOT NULL');
    await client.query('DELETE FROM product_history WHERE order_item_id IS NOT NULL');
    await client.query('DELETE FROM order_item');
    await client.query('DELETE FROM "order"');

    // Resumo denormalizado do cliente
    await client.query(
      'UPDATE customer SET total_orders = 0, total_spent = 0, last_order_at = NULL',
    );

    // Estoque = soma dos movimentos restantes (só quem controla estoque)
    await client.query(
      `UPDATE product p
         SET stock = COALESCE(
           (SELECT SUM(qty_change) FROM stock_movement m WHERE m.product_id = p.id), 0)
       WHERE p.stock IS NOT NULL`,
    );

    // Reinicia numeração dos pedidos
    const seq = await client.query(
      `SELECT pg_get_serial_sequence('"order"', 'code') AS seq`,
    );
    if (seq.rows[0]?.seq) {
      await client.query(`ALTER SEQUENCE ${seq.rows[0].seq} RESTART WITH 1`);
    }

    await client.query('COMMIT');
    console.log('Pronto. Pedidos zerados, estoque recalculado, numeração reiniciada.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
