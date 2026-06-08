// Testa DashboardService (resumos) em SQLite.
import { createTestPrisma } from '../test-utils/prisma-test';
import { resetDb } from '../test-utils/reset';
import { DashboardService } from './dashboard.service';
import { StoresService } from '../stores/stores.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.guard';

const prisma = createTestPrisma();
const px = prisma as unknown as PrismaService;
const stores = new StoresService(px);
const service = new DashboardService(px, stores);

const USER: AuthUser = { id: 'owner-dash-1', email: 'd@x.com', name: 'D' };
let storeId: string;
let customerId: string;

describe('DashboardService', () => {
  beforeAll(async () => {
    await resetDb(prisma);
    await prisma.user.create({
      data: { id: USER.id, email: USER.email, name: USER.name },
    });
    const store = await stores.create(USER, { name: `Loja ${Date.now()}` });
    storeId = store.id;
    const c = await prisma.customer.create({
      data: { ownerId: USER.id, name: 'Cliente' },
    });
    customerId = c.id;
    const pa = await prisma.product.create({
      data: { storeId, name: 'Item A', price: 10 },
    });
    const pb = await prisma.product.create({
      data: { storeId, name: 'Item B', price: 10 },
    });

    // Pedido A: criado hoje, saldo 20 em aberto
    await prisma.order.create({
      data: {
        ownerId: USER.id,
        customerId,
        total: 20,
        balanceDue: 20,
        itemsTotal: 20,
        items: {
          create: {
            productId: pa.id,
            storeId,
            productName: 'Item A',
            unitPrice: 10,
            quantity: 2,
            lineTotal: 20,
          },
        },
      },
    });

    // Pedido B: agendado p/ hoje, quitado
    const today = new Date();
    await prisma.order.create({
      data: {
        ownerId: USER.id,
        customerId,
        total: 10,
        balanceDue: 0,
        paidTotal: 10,
        paymentStatus: 'PAID',
        scheduledFor: today,
        items: {
          create: {
            productId: pb.id,
            storeId,
            productName: 'Item B',
            unitPrice: 10,
            quantity: 1,
            lineTotal: 10,
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('resume pedidos do dia, retiradas, faturamento e a receber', async () => {
    const s = await service.summary(USER.id);
    expect(s.ordersToday).toBe(2);
    expect(s.pickupsToday).toBe(1);
    expect(s.monthRevenue).toBe(30);
    expect(s.revenueByStore).toHaveLength(1);
    expect(s.revenueByStore[0].total).toBe(30);
    expect(s.receivable).toBe(20);
  });

  it('filtra por loja válida e bloqueia loja alheia', async () => {
    const s = await service.summary(USER.id, storeId);
    expect(s.monthRevenue).toBe(30);
    await expect(service.summary(USER.id, 'loja-x')).rejects.toThrow();
  });
});
