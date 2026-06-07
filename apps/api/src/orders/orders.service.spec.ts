// Testa OrdersService (núcleo: itens multi-loja, totais no server, status) em SQLite.
import { createTestPrisma } from '../test-utils/prisma-test';
import { resetDb } from '../test-utils/reset';
import { OrdersService } from './orders.service';
import { StoresService } from '../stores/stores.service';
import { CustomersService } from '../customers/customers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.guard';

const prisma = createTestPrisma();
const px = prisma as unknown as PrismaService;
const stores = new StoresService(px);
const customers = new CustomersService(px);
const service = new OrdersService(px, stores, customers);

const USER: AuthUser = { id: 'owner-ord-1', email: 'o@x.com', name: 'O' };

let storeA: string;
let storeB: string;
let prodA: string; // price 10, storeA
let prodB: string; // price 25, storeB
let customerId: string;

describe('OrdersService', () => {
  beforeAll(async () => {
    await resetDb(prisma);
    await prisma.user.create({
      data: { id: USER.id, email: USER.email, name: USER.name },
    });
    const a = await stores.create(USER, { name: `Loja A ${Date.now()}` });
    const b = await stores.create(USER, { name: `Loja B ${Date.now()}` });
    storeA = a.id;
    storeB = b.id;
    const pa = await prisma.product.create({
      data: { storeId: storeA, name: 'Produto A', price: 10 },
    });
    const pb = await prisma.product.create({
      data: { storeId: storeB, name: 'Produto B', price: 25 },
    });
    prodA = pa.id;
    prodB = pb.id;
    const c = await customers.create(USER.id, { name: 'Cliente' });
    customerId = c.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('cria pedido cruzando 2 lojas e congela nome/preço/loja', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [
        { productId: prodA, quantity: 2 },
        { productId: prodB, quantity: 1 },
      ],
    });
    expect(Number(order.itemsTotal)).toBe(45);
    expect(Number(order.total)).toBe(45);
    expect(Number(order.balanceDue)).toBe(45);
    expect(order.status).toBe('PENDING');
    expect(order.paymentStatus).toBe('UNPAID');
    expect(order.deliveryStatus).toBe('PENDING');
    expect(order.items).toHaveLength(2);

    const itemA = order.items.find((i) => i.productId === prodA)!;
    expect(itemA.productName).toBe('Produto A');
    expect(Number(itemA.unitPrice)).toBe(10);
    expect(itemA.storeId).toBe(storeA);
    expect(Number(itemA.lineTotal)).toBe(20);
  });

  it('aplica desconto FIXED e PERCENT', async () => {
    const fixed = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodB, quantity: 2 }], // 50
      discountType: 'FIXED',
      discountValue: 5,
    });
    expect(Number(fixed.discountAmount)).toBe(5);
    expect(Number(fixed.total)).toBe(45);
    expect(fixed.hasStoreDiscount).toBe(true);
    expect(Number(fixed.overrideValue)).toBe(45);

    const pct = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodB, quantity: 2 }], // 50
      discountType: 'PERCENT',
      discountValue: 10,
    });
    expect(Number(pct.discountAmount)).toBe(5);
    expect(Number(pct.total)).toBe(45);
  });

  it('soma frete no total', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }], // 10
      deliveryFee: 7,
    });
    expect(Number(order.total)).toBe(17);
  });

  it('edita em PENDING e bloqueia após READY', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }],
    });

    // editável em PENDING: muda frete -> recalcula total
    const edited = await service.update(USER.id, order.id, { deliveryFee: 3 });
    expect(Number(edited.total)).toBe(13);

    // avança até READY
    await service.changeStatus(USER.id, order.id, 'IN_PRODUCTION');
    await service.changeStatus(USER.id, order.id, 'READY');

    // edição agora bloqueada
    await expect(
      service.update(USER.id, order.id, { deliveryFee: 0 }),
    ).rejects.toThrow();
  });

  it('valida transições de status', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }],
    });
    // PENDING -> READY direto deve falhar
    await expect(
      service.changeStatus(USER.id, order.id, 'READY'),
    ).rejects.toThrow();
    // caminho válido
    await service.changeStatus(USER.id, order.id, 'IN_PRODUCTION');
    const ready = await service.changeStatus(USER.id, order.id, 'READY');
    expect(ready.status).toBe('READY');
    // READY -> PENDING inválido
    await expect(
      service.changeStatus(USER.id, order.id, 'PENDING'),
    ).rejects.toThrow();
  });

  it('cancela (soft-delete) e some da listagem', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }],
    });
    await service.remove(USER.id, order.id);
    await expect(service.get(USER.id, order.id)).rejects.toThrow();
    const list = await service.list(USER.id, {});
    expect(list.find((o) => o.id === order.id)).toBeUndefined();
  });

  it('filtra a listagem por loja', async () => {
    const onlyA = await service.list(USER.id, { storeId: storeA });
    expect(onlyA.every((o) => o.items.some((i) => i.storeId === storeA))).toBe(
      true,
    );
  });

  it('pagamento parcial, quitação, sobra e estorno', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodB, quantity: 2 }], // total 50
    });

    // parcial
    let o = await service.addPayment(USER.id, order.id, {
      amount: 20,
      method: 'PIX',
    });
    expect(o.paymentStatus).toBe('PARTIAL');
    expect(Number(o.paidTotal)).toBe(20);
    expect(Number(o.balanceDue)).toBe(30);

    // quita
    const p2 = await service.addPayment(USER.id, order.id, {
      amount: 30,
      method: 'CASH',
    });
    expect(p2.paymentStatus).toBe('PAID');
    expect(Number(p2.balanceDue)).toBe(0);

    // paga a mais (novo pedido)
    const over = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }], // 10
    });
    const po = await service.addPayment(USER.id, over.id, {
      amount: 15,
      method: 'CASH',
    });
    expect(po.paymentStatus).toBe('OVERPAID');

    // estorna tudo do 1º pedido -> REFUNDED
    const pays = await service.get(USER.id, order.id);
    for (const pay of pays.payments) {
      o = await service.removePayment(USER.id, pay.id);
    }
    expect(Number(o.paidTotal)).toBe(0);
    expect(o.paymentStatus).toBe('REFUNDED');
  });

  it('mantém o resumo do cliente (total no create, baixa no cancel)', async () => {
    const cli = await customers.create(USER.id, { name: 'Resumo' });
    const order = await service.create(USER.id, {
      customerId: cli.id,
      items: [{ productId: prodB, quantity: 2 }], // 50
    });
    let c = await customers.get(USER.id, cli.id);
    expect(c.totalOrders).toBe(1);
    expect(Number(c.totalSpent)).toBe(50);
    expect(c.lastOrderAt).not.toBeNull();

    await service.remove(USER.id, order.id);
    c = await customers.get(USER.id, cli.id);
    expect(c.totalOrders).toBe(0);
    expect(Number(c.totalSpent)).toBe(0);
  });

  it('bloqueia acesso de outro dono', async () => {
    const other: AuthUser = { id: 'intruso-ord', email: 'i@x.com', name: 'I' };
    await prisma.user.create({
      data: { id: other.id, email: other.email, name: other.name },
    });
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }],
    });
    await expect(service.get(other.id, order.id)).rejects.toThrow();
    await expect(
      service.update(other.id, order.id, { deliveryFee: 1 }),
    ).rejects.toThrow();
  });
});
