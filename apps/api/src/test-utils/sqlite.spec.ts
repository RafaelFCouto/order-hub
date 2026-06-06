// Prova o pipeline de testes em SQLite: cria loja+cliente+produto e lê de volta.
import { createTestPrisma } from './prisma-test';

const prisma = createTestPrisma();

describe('SQLite test pipeline', () => {
  beforeAll(async () => {
    // limpa dados deste teste (ordem respeita FKs)
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.storeMember.deleteMany();
    await prisma.store.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persiste e recupera entidades base', async () => {
    const user = await prisma.user.create({
      data: { id: 'u1', email: 'dona@loja.com', name: 'Dona' },
    });
    const store = await prisma.store.create({
      data: { name: 'Loja A', slug: 'loja-a' },
    });
    const customer = await prisma.customer.create({
      data: { ownerId: user.id, name: 'Maria', phone: '4899' },
    });
    const product = await prisma.product.create({
      data: { storeId: store.id, name: 'Bolo', price: 80, stock: 5 },
    });

    expect(product.price).toBe(80);
    expect(customer.totalOrders).toBe(0);

    const found = await prisma.product.findFirst({
      where: { storeId: store.id },
    });
    expect(found?.name).toBe('Bolo');
  });

  it('enum vira string no SQLite (status default)', async () => {
    const user = await prisma.user.findFirstOrThrow();
    const customer = await prisma.customer.findFirstOrThrow();
    const order = await prisma.order.create({
      data: { ownerId: user.id, customerId: customer.id },
    });
    expect(order.status).toBe('PENDING');
    expect(order.paymentStatus).toBe('UNPAID');
    expect(order.deliveryStatus).toBe('PENDING');
  });
});
