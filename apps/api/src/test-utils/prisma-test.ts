// Cliente Prisma para testes — SQLite via better-sqlite3.
// Schema/cliente derivados de scripts/gen-test-schema.mjs (rodar `pnpm test:db` antes).
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma-test/client';

export function createTestPrisma(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: 'file:./prisma/test.db' });
  return new PrismaClient({ adapter });
}
