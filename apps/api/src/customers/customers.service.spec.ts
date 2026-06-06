// Testa CustomersService (CRUD + busca + soft delete) em SQLite.
import { createTestPrisma } from '../test-utils/prisma-test';
import { resetDb } from '../test-utils/reset';
import { CustomersService } from './customers.service';
import type { PrismaService } from '../prisma/prisma.service';

const prisma = createTestPrisma();
const service = new CustomersService(prisma as unknown as PrismaService);

const OWNER = 'owner-cust-1';

describe('CustomersService', () => {
  beforeAll(async () => {
    await resetDb(prisma);
    await prisma.user.create({
      data: { id: OWNER, email: 'o@x.com', name: 'Owner' },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('cria e lista cliente do dono', async () => {
    await service.create(OWNER, { name: 'Maria', phone: '4899' });
    const list = await service.list(OWNER);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Maria');
    expect(list[0].totalOrders).toBe(0);
  });

  it('busca por nome/telefone', async () => {
    await service.create(OWNER, { name: 'Joao', phone: '5512' });
    expect(await service.list(OWNER, 'Mar')).toHaveLength(1);
    expect(await service.list(OWNER, '5512')).toHaveLength(1);
    expect(await service.list(OWNER, 'zzz')).toHaveLength(0);
  });

  it('atualiza e faz soft delete', async () => {
    const c = await service.create(OWNER, { name: 'Temp' });
    const upd = await service.update(OWNER, c.id, { phone: '999' });
    expect(upd.phone).toBe('999');

    await service.remove(OWNER, c.id);
    const list = await service.list(OWNER);
    expect(list.find((x) => x.id === c.id)).toBeUndefined();
  });
});
