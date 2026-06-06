// Deriva prisma/schema.test.prisma (SQLite) a partir do schema.prisma (Postgres).
// Mantém UMA fonte de verdade. Para testes apenas.
// Transformações:
//   - provider postgresql -> sqlite (url file local)
//   - generator output -> ../src/generated/prisma-test
//   - remove atributos nativos @db.* (Uuid/Timestamptz/Decimal...)
//   - Decimal -> Float (SQLite não tem Decimal)
//   - enums -> String (SQLite não tem enum); defaults de enum viram string
//   - @default(autoincrement()) -> @default(0) (autoincrement só em @id no SQLite)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = join(here, '..', 'prisma', 'schema.prisma');
const outPath = join(here, '..', 'prisma', 'schema.test.prisma');

let s = readFileSync(srcPath, 'utf8');

// 1) datasource -> sqlite (sem url: Prisma 7 exige url no prisma.config.test.ts)
s = s.replace(
  /datasource\s+db\s*\{[^}]*\}/m,
  `datasource db {\n  provider = "sqlite"\n}`,
);

// 2) generator output -> client de teste
s = s.replace(
  /(output\s*=\s*")[^"]*(")/,
  `$1../src/generated/prisma-test$2`,
);

// 3) coleta nomes de enums e remove os blocos
const enumNames = [...s.matchAll(/enum\s+(\w+)\s*\{/g)].map((m) => m[1]);
s = s.replace(/enum\s+\w+\s*\{[^}]*\}\s*/g, '');

// 4) remove atributos nativos @db.*
s = s.replace(/\s*@db\.\w+(\([^)]*\))?/g, '');

// 5) substitui tipos enum por String (apenas na posição de tipo do campo)
for (const name of enumNames) {
  // campo:  nome   TipoEnum[?]  ...
  const re = new RegExp(`(^\\s*\\w+\\s+)${name}(\\??)(\\s)`, 'gm');
  s = s.replace(re, `$1String$2$3`);
}

// 6) defaults de enum (IDENTIFICADOR_MAIUSCULO) viram string literal
s = s.replace(/@default\(([A-Z][A-Z_]*)\)/g, '@default("$1")');

// 7) Decimal -> Float
s = s.replace(/(^\s*\w+\s+)Decimal(\??)/gm, '$1Float$2');

// 8) autoincrement em não-@id -> 0
s = s.replace(/@default\(autoincrement\(\)\)/g, '@default(0)');

const banner = `// ⚠️ GERADO automaticamente por scripts/gen-test-schema.mjs — NÃO editar.\n// Fonte: prisma/schema.prisma. SQLite só para testes.\n\n`;
writeFileSync(outPath, banner + s.trimStart());
console.log('schema.test.prisma gerado (SQLite) a partir de schema.prisma');
