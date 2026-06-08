// Testa ProductsService (categorias + produtos, por loja) em SQLite.
import { createTestPrisma } from '../test-utils/prisma-test';
import { resetDb } from '../test-utils/reset';
import { ProductsService } from './products.service';
import { StoresService } from '../stores/stores.service';
import { StockService } from '../stock/stock.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.guard';

const prisma = createTestPrisma();
const px = prisma as unknown as PrismaService;
const stores = new StoresService(px);
const stock = new StockService();
const service = new ProductsService(px, stores, stock);

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

  it('renomeia e reativa categoria', async () => {
    const cat = await service.createCategory(USER.id, {
      storeId,
      name: 'Tortas',
    });
    const renamed = await service.updateCategory(USER.id, cat.id, {
      name: 'Tortas Doces',
    });
    expect(renamed.name).toBe('Tortas Doces');
    expect(renamed.updatedUserId).toBe(USER.id);

    await service.updateCategory(USER.id, cat.id, { active: false });
    const visiveis = await service.listCategories(USER.id, storeId);
    expect(visiveis.find((c) => c.id === cat.id)).toBeUndefined();

    const comExcluidas = await service.listCategories(USER.id, storeId, true);
    expect(comExcluidas.find((c) => c.id === cat.id)).toBeDefined();

    const reativada = await service.updateCategory(USER.id, cat.id, {
      active: true,
    });
    expect(reativada.deletedAt).toBeNull();
  });

  it('exclui categoria e solta os produtos vinculados', async () => {
    const cat = await service.createCategory(USER.id, {
      storeId,
      name: 'Salgados',
    });
    const prod = await service.create(USER.id, {
      storeId,
      categoryId: cat.id,
      name: 'Coxinha',
      price: 8,
    });

    await service.removeCategory(USER.id, cat.id);

    // categoria some da listagem
    const list = await service.listCategories(USER.id, storeId);
    expect(list.find((c) => c.id === cat.id)).toBeUndefined();

    // registra quem excluiu
    const comExcluidas = await service.listCategories(USER.id, storeId, true);
    const excluida = comExcluidas.find((c) => c.id === cat.id);
    expect(excluida?.deletedUserId).toBe(USER.id);

    // produto preservado, sem categoria
    const solto = await service.get(USER.id, prod.id);
    expect(solto.categoryId).toBeNull();
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

  it('audita mudança de preço e ajuste de estoque', async () => {
    const prod = await service.create(USER.id, {
      storeId,
      name: 'Auditado',
      price: 10,
      stock: 5,
    });
    await service.update(USER.id, prod.id, { price: 12, stock: 8 });

    const hist = await prisma.productHistory.findMany({
      where: { productId: prod.id },
    });
    expect(hist.find((h) => h.eventType === 'PRICE_CHANGE')).toBeDefined();
    const adj = hist.find((h) => h.eventType === 'STOCK_ADJUST');
    expect(adj).toBeDefined();
    expect(adj!.qtyChange).toBe(3);
  });
});
