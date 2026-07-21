// Testa OrdersService (núcleo: itens multi-loja, totais no server, status) em SQLite.
import { createTestPrisma } from '../test-utils/prisma-test';
import { resetDb } from '../test-utils/reset';
import { OrdersService } from './orders.service';
import { StoresService } from '../stores/stores.service';
import { CustomersService } from '../customers/customers.service';
import { StockService } from '../stock/stock.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.guard';

const prisma = createTestPrisma();
const px = prisma as unknown as PrismaService;
const stores = new StoresService(px);
const customers = new CustomersService(px);
const stock = new StockService();
const service = new OrdersService(px, stores, customers, stock);

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

  it('soma frete no total só quando a entrega é por nós', async () => {
    // entrega por nós: frete entra no total
    const porNos = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }], // 10
      deliveryFee: 7,
      deliveryByUs: true,
    });
    expect(Number(porNos.total)).toBe(17);

    // entrega não é por nós: frete NÃO entra no total
    const naoPorNos = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }], // 10
      deliveryFee: 7,
      deliveryByUs: false,
    });
    expect(Number(naoPorNos.total)).toBe(10);
  });

  it('alternar deliveryByUs no update recalcula o total', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }], // 10
      deliveryFee: 7,
      deliveryByUs: false,
    });
    expect(Number(order.total)).toBe(10);

    const edited = await service.update(USER.id, order.id, { deliveryByUs: true });
    expect(Number(edited.total)).toBe(17);
  });

  it('edita em PENDING e bloqueia após READY', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }],
      deliveryByUs: true,
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

  it('entrega: envia, trava recebido sem pagar, recebe após pagar', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodB, quantity: 1 }], // 25
    });
    const d = await service.createDelivery(USER.id, order.id, {
      method: 'MOTOBOY',
      cost: 8,
    });
    expect(d.deliveries).toHaveLength(1);
    const delivId = d.deliveries[0].id;

    // segunda entrega no mesmo pedido falha
    await expect(
      service.createDelivery(USER.id, order.id, { method: 'PICKUP' }),
    ).rejects.toThrow();

    // marca enviado
    const shipped = await service.updateDelivery(USER.id, delivId, {
      setShipped: true,
    });
    expect(shipped.deliveryStatus).toBe('SHIPPED');

    // receber sem pagar -> bloqueia (regra 4.4.1)
    await expect(
      service.updateDelivery(USER.id, delivId, { setReceived: true }),
    ).rejects.toThrow();

    // paga e recebe
    await service.addPayment(USER.id, order.id, { amount: 25, method: 'PIX' });
    const received = await service.updateDelivery(USER.id, delivId, {
      setReceived: true,
    });
    expect(received.deliveryStatus).toBe('RECEIVED');

    // remover entrega volta a PENDING
    const undone = await service.removeDelivery(USER.id, delivId);
    expect(undone.deliveryStatus).toBe('PENDING');
    expect(undone.deliveries).toHaveLength(0);
  });

  it('entrega PICKUP recebe direto', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }], // 10
    });
    await service.addPayment(USER.id, order.id, { amount: 10, method: 'CASH' });
    const d = await service.createDelivery(USER.id, order.id, {
      method: 'PICKUP',
    });
    const received = await service.updateDelivery(USER.id, d.deliveries[0].id, {
      setReceived: true,
    });
    expect(received.deliveryStatus).toBe('RECEIVED');
  });

  it('lançamento retroativo: já pago e entregue', async () => {
    const placed = '2026-01-10T12:00:00.000Z';
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodB, quantity: 2 }], // 50
      completed: true,
      paymentMethod: 'PIX',
      placedAt: placed,
    });
    expect(order.status).toBe('READY');
    expect(order.paymentStatus).toBe('PAID');
    expect(order.deliveryStatus).toBe('RECEIVED');
    expect(Number(order.paidTotal)).toBe(50);
    expect(Number(order.balanceDue)).toBe(0);
    expect(new Date(order.createdAt).toISOString()).toBe(placed);

    const full = await service.get(USER.id, order.id);
    expect(full.payments).toHaveLength(1);
    expect(full.deliveries).toHaveLength(1);
    expect(full.deliveries[0].method).toBe('PICKUP');
  });

  it('separa concluídos (pronto+pago+entregue) na listagem', async () => {
    const done = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }],
      completed: true,
      paymentMethod: 'PIX',
    });
    const active = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 1 }],
    });

    const concluidos = await service.list(USER.id, { done: true });
    expect(concluidos.find((o) => o.id === done.id)).toBeDefined();
    expect(concluidos.find((o) => o.id === active.id)).toBeUndefined();

    const ativos = await service.list(USER.id, { done: false });
    expect(ativos.find((o) => o.id === active.id)).toBeDefined();
    expect(ativos.find((o) => o.id === done.id)).toBeUndefined();
  });

  it('baixa estoque na venda e devolve no cancelamento', async () => {
    const p = await prisma.product.create({
      data: { storeId: storeA, name: 'ComEstoque', price: 10, stock: 5 },
    });
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: p.id, quantity: 2 }],
    });
    let prod = await prisma.product.findUnique({ where: { id: p.id } });
    expect(prod!.stock).toBe(3);
    const movs = await prisma.stockMovement.findMany({
      where: { productId: p.id },
    });
    expect(movs).toHaveLength(1);

    await service.remove(USER.id, order.id);
    prod = await prisma.product.findUnique({ where: { id: p.id } });
    expect(prod!.stock).toBe(5);
  });

  it('venda além do estoque fica negativa e avisa', async () => {
    const p = await prisma.product.create({
      data: { storeId: storeA, name: 'Pouco', price: 10, stock: 1 },
    });
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: p.id, quantity: 3 }],
    });
    expect(
      (order as { stockWarnings?: unknown[] }).stockWarnings,
    ).toHaveLength(1);
    const prod = await prisma.product.findUnique({ where: { id: p.id } });
    expect(prod!.stock).toBe(-2);
  });

  it('produto sem controle de estoque (null) não mexe', async () => {
    const before = await prisma.product.findUnique({ where: { id: prodA } });
    await service.create(USER.id, {
      customerId,
      items: [{ productId: prodA, quantity: 5 }],
    });
    const after = await prisma.product.findUnique({ where: { id: prodA } });
    expect(after!.stock).toBe(before!.stock); // segue null
  });

  it('editar itens reajusta o estoque', async () => {
    const p = await prisma.product.create({
      data: { storeId: storeA, name: 'EditEstoque', price: 10, stock: 10 },
    });
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: p.id, quantity: 2 }], // -> 8
    });
    await service.update(USER.id, order.id, {
      items: [{ productId: p.id, quantity: 5 }], // devolve 2 (10), baixa 5 (5)
    });
    const prod = await prisma.product.findUnique({ where: { id: p.id } });
    expect(prod!.stock).toBe(5);
  });

  it('registra timeline do pedido', async () => {
    const order = await service.create(USER.id, {
      customerId,
      items: [{ productId: prodB, quantity: 1 }], // 25
    });
    await service.addPayment(USER.id, order.id, { amount: 25, method: 'PIX' });
    const d = await service.createDelivery(USER.id, order.id, {
      method: 'PICKUP',
    });
    await service.updateDelivery(USER.id, d.deliveries[0].id, {
      setReceived: true,
    });

    const full = await service.get(USER.id, order.id);
    const types = full.events.map((e) => e.type);
    expect(types).toContain('CREATED');
    expect(types).toContain('PAYMENT');
    expect(types).toContain('DELIVERY');
    expect(full.events[0].type).toBe('CREATED'); // ordem cronológica

    await service.remove(USER.id, order.id);
    // não dá pra get cancelado; confere direto no banco
    const ev = await prisma.orderEvent.findMany({
      where: { orderId: order.id, type: 'CANCELED' },
    });
    expect(ev).toHaveLength(1);
  });

  it('combo: escolhe sabores, valida soma e baixa estoque', async () => {
    const cat = await prisma.productCategory.create({
      data: { storeId: storeA, name: 'Cookies' },
    });
    const choc = await prisma.product.create({
      data: { storeId: storeA, categoryId: cat.id, name: 'Choco', price: 0, stock: 10 },
    });
    const ban = await prisma.product.create({
      data: { storeId: storeA, categoryId: cat.id, name: 'Baunilha', price: 0, stock: 10 },
    });
    const box = await prisma.product.create({
      data: {
        storeId: storeA,
        name: 'Caixa 4 Cookies',
        price: 40,
        stock: 5,
        comboSize: 4,
        comboCategoryId: cat.id,
      },
    });

    const order = await service.create(USER.id, {
      customerId,
      items: [
        {
          productId: box.id,
          quantity: 1,
          options: [
            { productId: choc.id, quantity: 2 },
            { productId: ban.id, quantity: 2 },
          ],
        },
      ],
    });
    expect(Number(order.total)).toBe(40);

    const full = await service.get(USER.id, order.id);
    expect(full.items[0].options).toHaveLength(2);

    // estoque: caixa -1, cada sabor -2
    expect((await prisma.product.findUnique({ where: { id: box.id } }))!.stock).toBe(4);
    expect((await prisma.product.findUnique({ where: { id: choc.id } }))!.stock).toBe(8);
    expect((await prisma.product.findUnique({ where: { id: ban.id } }))!.stock).toBe(8);

    // soma de sabores != comboSize -> erro
    await expect(
      service.create(USER.id, {
        customerId,
        items: [
          { productId: box.id, quantity: 1, options: [{ productId: choc.id, quantity: 3 }] },
        ],
      }),
    ).rejects.toThrow();

    // sabor fora da categoria do combo -> erro
    await expect(
      service.create(USER.id, {
        customerId,
        items: [
          {
            productId: box.id,
            quantity: 1,
            options: [
              { productId: prodA, quantity: 2 },
              { productId: choc.id, quantity: 2 },
            ],
          },
        ],
      }),
    ).rejects.toThrow();
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
