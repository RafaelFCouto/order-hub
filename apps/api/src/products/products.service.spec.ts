// Testa ProductsService (categorias + produtos, por loja) em SQLite.
import { createTestPrisma } from '../test-utils/prisma-test';
import { resetDb } from '../test-utils/reset';
import { ProductsService } from './products.service';
import { StoresService } from '../stores/stores.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.guard';

const prisma = createTestPrisma();
const px = prisma as unknown as PrismaService;
const stores = new StoresService(px);
const service = new ProductsService(px, stores);

const USER: AuthUser = { id: 'owner-prod-1', email: 'p@x.com', name: 'P' };
let storeId: string;

describe('ProductsService', () => {
  beforeAll(async () => {
    await resetDb(prisma);
    await prisma.user.create({
      data: { id: USER.id, email: USER.email, name: USER.name },
    });
    const store = await stores.create(USER, { name: `Loja ${Date.now()}` });
    storeId = store.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('cria categoria e produto na loja', async () => {
    const cat = await service.createCategory(USER.id, {
      storeId,
      name: 'Bolos',
    });
    const prod = await service.create(USER.id, {
      storeId,
      categoryId: cat.id,
      name: 'Bolo de Cenoura',
      price: 85.5,
      stock: 3,
    });
    expect(prod.price).toBe(85.5);
    expect(prod.stock).toBe(3);
    expect(prod.active).toBe(true);

    const list = await service.list(USER.id, storeId);
    expect(list).toHaveLength(1);
  });

  it('filtra por active e faz soft delete', async () => {
    const p = await service.create(USER.id, {
      storeId,
      name: 'Inativo',
      price: 10,
      active: false,
    });
    expect(await service.list(USER.id, storeId, { active: true })).toHaveLength(
      1,
    );
    expect(
      await service.list(USER.id, storeId, { active: false }),
    ).toHaveLength(1);

    await service.remove(USER.id, p.id);
    const all = await service.list(USER.id, storeId);
    expect(all.find((x) => x.id === p.id)).toBeUndefined();
  });

  it('bloqueia acesso de quem não é membro da loja', async () => {
    const other: AuthUser = { id: 'intruso', email: 'i@x.com', name: 'I' };
    await prisma.user.upsert({
      where: { id: other.id },
      update: {},
      create: { id: other.id, email: other.email, name: other.name },
    });
    await expect(service.list(other.id, storeId)).rejects.toThrow();
  });
});
