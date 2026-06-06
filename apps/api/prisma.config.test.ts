// Config Prisma para os testes (SQLite). Usado via: prisma <cmd> --config prisma.config.test.ts
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.test.prisma',
  datasource: {
    url: 'file:./prisma/test.db',
  },
});
