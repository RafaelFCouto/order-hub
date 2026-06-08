import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoresService } from '../stores/stores.service';
import { CustomersService } from '../customers/customers.service';
import { StockService } from '../stock/stock.service';
import {
  DiscountType,
  OrderEventType,
  OrderStatus,
  PaymentStatus,
} from '../generated/prisma/enums';
import { CreateOrderDto, OrderItemInput, UpdateOrderDto } from './orders.dto';
import { CreatePaymentDto } from './payments.dto';
import { CreateDeliveryDto, UpdateDeliveryDto } from './deliveries.dto';

/** Transições válidas de produção (regra 4.1). */
const STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['IN_PRODUCTION', 'CANCELED'],
  IN_PRODUCTION: ['READY', 'CANCELED'],
  READY: ['CANCELED'],
  CANCELED: [],
};

/** Itens/desconto/frete só editáveis nestes status (regra 4.4.2). */
const EDITABLE_STATUS: OrderStatus[] = ['PENDING', 'IN_PRODUCTION'];

const money = (n: number) => Math.round(n * 100) / 100;
const brlMsg = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

const STATUS_PT: Record<string, string> = {
  PENDING: 'Pendente',
  IN_PRODUCTION: 'Em produção',
  READY: 'Pronto',
  CANCELED: 'Cancelado',
};
const METHOD_PT: Record<string, string> = {
  PIX: 'PIX',
  CASH: 'Dinheiro',
  CARD: 'Cartão',
  OTHER: 'Outro',
};
const DMETHOD_PT: Record<string, string> = {
  PICKUP: 'Retirada',
  OWN_DELIVERY: 'Entrega própria',
  UBER: 'Uber',
  MOTOBOY: 'Motoboy',
  CORREIOS: 'Correios',
  OTHER: 'Outro',
};

interface BuiltOption {
  productId: string;
  productName: string;
  quantity: number;
}
/** Subconjunto p/ expandir estoque (itens carregados ou recém-construídos). */
type LoadedItem = {
  productId: string;
  quantity: number;
  options?: { productId: string; quantity: number }[];
};
interface BuiltItem {
  productId: string;
  storeId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  options: BuiltOption[];
}

interface Totals {
  itemsTotal: number;
  discountAmount: number;
  total: number;
  hasStoreDiscount: boolean;
  overrideValue: number | null;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
    private readonly customers: CustomersService,
    private readonly stock: StockService,
  ) {}

  // ---------- helpers ----------

  /** Carrega cada produto, valida acesso à loja e congela nome/preço/loja. */
  private async buildItems(
    ownerId: string,
    items: OrderItemInput[],
  ): Promise<BuiltItem[]> {
    const built: BuiltItem[] = [];
    for (const item of items) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, deletedAt: null },
      });
      if (!product) {
        throw new NotFoundException(`Produto ${item.productId} não encontrado`);
      }
      await this.stores.assertMember(ownerId, product.storeId);
      const unitPrice = Number(product.price);

      // combo: valida e congela os sabores escolhidos
      let options: BuiltOption[] = [];
      if (product.comboSize != null) {
        const opts = item.options ?? [];
        const sum = opts.reduce((s, o) => s + o.quantity, 0);
        if (sum !== product.comboSize) {
          throw new BadRequestException(
            `Combo "${product.name}" exige ${product.comboSize} sabor(es); recebido ${sum}`,
          );
        }
        options = await Promise.all(
          opts.map(async (o) => {
            const flavor = await this.prisma.product.findFirst({
              where: {
                id: o.productId,
                deletedAt: null,
                storeId: product.storeId,
                categoryId: product.comboCategoryId,
              },
            });
            if (!flavor) {
              throw new BadRequestException(
                `Sabor ${o.productId} inválido para o combo "${product.name}"`,
              );
            }
            return {
              productId: flavor.id,
              productName: flavor.name,
              quantity: o.quantity,
            };
          }),
        );
      }

      built.push({
        productId: product.id,
        storeId: product.storeId,
        productName: product.name,
        unitPrice,
        quantity: item.quantity,
        lineTotal: money(unitPrice * item.quantity),
        options,
      });
    }
    return built;
  }

  /** Lista plana p/ estoque: a caixa + cada sabor (qty × qtd de caixas). */
  private stockList(items: BuiltItem[] | LoadedItem[]) {
    const moves: { productId: string; quantity: number }[] = [];
    for (const it of items) {
      moves.push({ productId: it.productId, quantity: it.quantity });
      for (const o of it.options ?? []) {
        moves.push({ productId: o.productId, quantity: o.quantity * it.quantity });
      }
    }
    return moves;
  }

  /** Cálculo puro dos totais (regra de desconto de loja). */
  private computeTotals(
    items: BuiltItem[],
    discountType: DiscountType,
    discountValue: number,
    deliveryFee: number,
  ): Totals {
    const itemsTotal = money(items.reduce((s, i) => s + i.lineTotal, 0));
    let discountAmount = 0;
    if (discountType === 'FIXED') discountAmount = Math.min(discountValue, itemsTotal);
    else if (discountType === 'PERCENT')
      discountAmount = (itemsTotal * discountValue) / 100;
    discountAmount = money(discountAmount);
    const total = money(itemsTotal - discountAmount + deliveryFee);
    const hasStoreDiscount = discountType !== 'NONE' && discountAmount > 0;
    return {
      itemsTotal,
      discountAmount,
      total,
      hasStoreDiscount,
      overrideValue: hasStoreDiscount ? total : null,
    };
  }

  /** payment_status derivado (regra 4.2). REFUNDED é marca manual, fora daqui. */
  private derivePaymentStatus(paidTotal: number, total: number): PaymentStatus {
    if (paidTotal <= 0) return 'UNPAID';
    if (paidTotal < total) return 'PARTIAL';
    if (paidTotal === total) return 'PAID';
    return 'OVERPAID';
  }

  /** Pedido do dono, não deletado, com itens ativos. 404 caso contrário. */
  private async loadOwned(ownerId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, ownerId, deletedAt: null },
      include: { items: { where: { deletedAt: null }, include: { options: true } } },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado');
    return order;
  }

  // ---------- comandos ----------

  async create(ownerId: string, dto: CreateOrderDto) {
    await this.customers.get(ownerId, dto.customerId); // valida dono do cliente
    const items = await this.buildItems(ownerId, dto.items);

    const discountType = dto.discountType ?? 'NONE';
    const discountValue = dto.discountValue ?? 0;
    const deliveryFee = dto.deliveryFee ?? 0;
    const t = this.computeTotals(items, discountType, discountValue, deliveryFee);
    const placedAt = dto.placedAt ? new Date(dto.placedAt) : new Date();
    const completed = dto.completed === true;
    const paymentStatus = completed
      ? this.derivePaymentStatus(t.total, t.total) // PAID (ou OVERPAID nunca aqui)
      : this.derivePaymentStatus(0, t.total);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          ownerId,
          customerId: dto.customerId,
          createdAt: placedAt,
          status: completed ? 'READY' : 'PENDING',
          paymentStatus,
          deliveryStatus: completed ? 'RECEIVED' : 'PENDING',
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
          itemsTotal: t.itemsTotal,
          discountType,
          discountValue,
          discountAmount: t.discountAmount,
          hasStoreDiscount: t.hasStoreDiscount,
          overrideValue: t.overrideValue,
          deliveryFee,
          total: t.total,
          paidTotal: completed ? t.total : 0,
          balanceDue: completed ? 0 : t.total,
          notes: dto.notes,
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              storeId: i.storeId,
              productName: i.productName,
              unitPrice: i.unitPrice,
              quantity: i.quantity,
              lineTotal: i.lineTotal,
              options: i.options.length ? { create: i.options } : undefined,
            })),
          },
        },
        include: { items: true },
      });

      // lançamento passado: registra pagamento total + entrega recebida
      if (completed) {
        if (t.total > 0) {
          await tx.payment.create({
            data: {
              orderId: order.id,
              amount: t.total,
              method: dto.paymentMethod ?? 'CASH',
              paidAt: placedAt,
            },
          });
        }
        await tx.delivery.create({
          data: { orderId: order.id, method: 'PICKUP', receivedAt: placedAt },
        });
      }

      // timeline
      await this.logEvent(
        tx,
        order.id,
        'CREATED',
        'Pedido criado',
        ownerId,
        placedAt,
      );
      if (completed) {
        await this.logEvent(
          tx,
          order.id,
          'PAYMENT',
          `Pagamento total ${brlMsg(t.total)} (${METHOD_PT[dto.paymentMethod ?? 'CASH']})`,
          ownerId,
          new Date(placedAt.getTime() + 1),
        );
        await this.logEvent(
          tx,
          order.id,
          'DELIVERY',
          'Entregue (retirada)',
          ownerId,
          new Date(placedAt.getTime() + 2),
        );
        await this.logEvent(
          tx,
          order.id,
          'STATUS',
          'Produção: Pronto',
          ownerId,
          new Date(placedAt.getTime() + 3),
        );
      }

      // baixa de estoque (caixa + sabores; não bloqueia)
      const warnings = await this.stock.sale(
        tx,
        this.stockList(items),
        ownerId,
      );

      await this.bumpCustomer(tx, dto.customerId, t.total, 1);
      return Object.assign(order, { stockWarnings: warnings });
    });
  }

  async update(ownerId: string, id: string, dto: UpdateOrderDto) {
    const order = await this.loadOwned(ownerId, id);
    if (!EDITABLE_STATUS.includes(order.status as OrderStatus)) {
      throw new ForbiddenException(
        'Pedido não editável após READY; cancele e refaça (regra 4.4.2)',
      );
    }

    if (dto.customerId) await this.customers.get(ownerId, dto.customerId);

    // itens: novos do payload, ou os atuais (p/ recalcular com desconto/frete novo)
    const items: BuiltItem[] = dto.items
      ? await this.buildItems(ownerId, dto.items)
      : order.items.map((i) => ({
          productId: i.productId,
          storeId: i.storeId,
          productName: i.productName,
          unitPrice: Number(i.unitPrice),
          quantity: i.quantity,
          lineTotal: Number(i.lineTotal),
          options: i.options.map((o) => ({
            productId: o.productId,
            productName: o.productName,
            quantity: o.quantity,
          })),
        }));

    const discountType = dto.discountType ?? (order.discountType as DiscountType);
    const discountValue = dto.discountValue ?? Number(order.discountValue);
    const deliveryFee = dto.deliveryFee ?? Number(order.deliveryFee);
    const t = this.computeTotals(items, discountType, discountValue, deliveryFee);
    const paidTotal = Number(order.paidTotal);
    const paymentStatus = this.derivePaymentStatus(paidTotal, t.total);

    const oldTotal = Number(order.total);
    const oldCustomer = order.customerId;
    const newCustomer = dto.customerId ?? order.customerId;

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        // devolve estoque dos itens antigos (caixa + sabores)
        await this.stock.restock(tx, this.stockList(order.items), ownerId);
        await tx.orderItem.updateMany({
          where: { orderId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        // recria itens (com sabores, se combo)
        for (const i of items) {
          await tx.orderItem.create({
            data: {
              orderId: id,
              productId: i.productId,
              storeId: i.storeId,
              productName: i.productName,
              unitPrice: i.unitPrice,
              quantity: i.quantity,
              lineTotal: i.lineTotal,
              options: i.options.length ? { create: i.options } : undefined,
            },
          });
        }
        // baixa estoque dos itens novos
        await this.stock.sale(tx, this.stockList(items), ownerId);
      }
      const updated = await tx.order.update({
        where: { id },
        data: {
          customerId: newCustomer,
          scheduledFor:
            dto.scheduledFor !== undefined
              ? dto.scheduledFor
                ? new Date(dto.scheduledFor)
                : null
              : order.scheduledFor,
          notes: dto.notes ?? order.notes,
          itemsTotal: t.itemsTotal,
          discountType,
          discountValue,
          discountAmount: t.discountAmount,
          hasStoreDiscount: t.hasStoreDiscount,
          overrideValue: t.overrideValue,
          deliveryFee,
          total: t.total,
          balanceDue: money(t.total - paidTotal),
          paymentStatus,
        },
        include: { items: { where: { deletedAt: null } } },
      });

      // resumo do cliente (regra: baseado em order.total)
      if (newCustomer === oldCustomer) {
        await this.bumpCustomer(tx, oldCustomer, t.total - oldTotal, 0);
      } else {
        await this.bumpCustomer(tx, oldCustomer, -oldTotal, -1);
        await this.bumpCustomer(tx, newCustomer, t.total, 1);
      }
      await this.logEvent(tx, id, 'EDITED', 'Pedido editado', ownerId);
      return updated;
    });
  }

  async changeStatus(ownerId: string, id: string, next: OrderStatus) {
    const order = await this.loadOwned(ownerId, id);
    const current = order.status as OrderStatus;
    if (current === next) return order;
    if (!STATUS_FLOW[current].includes(next)) {
      throw new BadRequestException(
        `Transição inválida: ${current} → ${next}`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: { status: next },
        include: { items: { where: { deletedAt: null } } },
      });
      await this.logEvent(
        tx,
        id,
        next === 'CANCELED' ? 'CANCELED' : 'STATUS',
        `Produção: ${STATUS_PT[next]}`,
        ownerId,
      );
      return updated;
    });
  }

  /** Soft-delete = cancela. Não estorna pagamentos (regra 4.4.3, manual). */
  async remove(ownerId: string, id: string) {
    const order = await this.loadOwned(ownerId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'CANCELED' },
      });
      // devolve estoque dos itens (caixa + sabores)
      await this.stock.restock(tx, this.stockList(order.items), ownerId);
      await this.bumpCustomer(tx, order.customerId, -Number(order.total), -1);
      await this.logEvent(tx, id, 'CANCELED', 'Pedido cancelado', ownerId);
    });
    return { ok: true };
  }

  // ---------- pagamentos ----------

  async addPayment(ownerId: string, orderId: string, dto: CreatePaymentDto) {
    await this.loadOwned(ownerId, orderId); // escopo + 404
    await this.prisma.payment.create({
      data: {
        orderId,
        amount: dto.amount,
        method: dto.method,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
        notes: dto.notes,
      },
    });
    await this.logEvent(
      this.prisma,
      orderId,
      'PAYMENT',
      `Pagamento ${brlMsg(dto.amount)} (${METHOD_PT[dto.method]})`,
      ownerId,
    );
    return this.recalcPayment(orderId);
  }

  async removePayment(ownerId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      include: { order: true },
    });
    if (!payment || payment.order.ownerId !== ownerId || payment.order.deletedAt) {
      throw new NotFoundException('Pagamento não encontrado');
    }
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { deletedAt: new Date() },
    });
    await this.logEvent(
      this.prisma,
      payment.orderId,
      'REFUND',
      `Estorno ${brlMsg(Number(payment.amount))}`,
      ownerId,
    );
    return this.recalcPayment(payment.orderId);
  }

  /** Recalcula paidTotal/balanceDue/paymentStatus do pedido (regra 4.2). */
  private async recalcPayment(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    const active = await this.prisma.payment.aggregate({
      where: { orderId, deletedAt: null },
      _sum: { amount: true },
    });
    const paidTotal = money(Number(active._sum.amount ?? 0));
    const total = Number(order.total);

    let paymentStatus = this.derivePaymentStatus(paidTotal, total);
    if (paidTotal === 0) {
      // se já houve pagamento (algum soft-deleted), zerar = REFUNDED
      const had = await this.prisma.payment.count({
        where: { orderId, deletedAt: { not: null } },
      });
      if (had > 0) paymentStatus = 'REFUNDED';
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        paidTotal,
        balanceDue: money(total - paidTotal),
        paymentStatus,
      },
      include: {
        items: { where: { deletedAt: null } },
        payments: { where: { deletedAt: null } },
      },
    });
  }

  /** Mantém o resumo denormalizado do cliente. */
  private async bumpCustomer(
    tx: Pick<PrismaService, 'customer'>,
    customerId: string,
    deltaTotal: number,
    deltaOrders: number,
  ) {
    const c = await tx.customer.findUnique({ where: { id: customerId } });
    if (!c) return;
    await tx.customer.update({
      where: { id: customerId },
      data: {
        totalOrders: Math.max(0, c.totalOrders + deltaOrders),
        totalSpent: money(Number(c.totalSpent) + deltaTotal),
        ...(deltaOrders > 0 ? { lastOrderAt: new Date() } : {}),
      },
    });
  }

  /** Registra um evento na timeline do pedido. */
  private async logEvent(
    tx: Pick<PrismaService, 'orderEvent'>,
    orderId: string,
    type: OrderEventType,
    message: string,
    actorId?: string,
    createdAt?: Date,
  ) {
    await tx.orderEvent.create({
      data: {
        orderId,
        type,
        message,
        actorId: actorId ?? null,
        ...(createdAt ? { createdAt } : {}),
      },
    });
  }

  // ---------- entrega ----------

  async createDelivery(ownerId: string, orderId: string, dto: CreateDeliveryDto) {
    const order = await this.loadOwned(ownerId, orderId);
    if (order.status === 'CANCELED') {
      throw new BadRequestException('Pedido cancelado');
    }
    const existing = await this.prisma.delivery.findFirst({
      where: { orderId, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Pedido já tem entrega');

    await this.prisma.delivery.create({
      data: {
        orderId,
        method: dto.method,
        recipientName: dto.recipientName,
        address: dto.address,
        courierName: dto.courierName,
        cost: dto.cost,
        notes: dto.notes,
      },
    });
    await this.logEvent(
      this.prisma,
      orderId,
      'DELIVERY',
      `Entrega registrada: ${DMETHOD_PT[dto.method]}`,
      ownerId,
    );
    return this.get(ownerId, orderId);
  }

  async updateDelivery(
    ownerId: string,
    deliveryId: string,
    dto: UpdateDeliveryDto,
  ) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, deletedAt: null },
      include: { order: true },
    });
    if (
      !delivery ||
      delivery.order.ownerId !== ownerId ||
      delivery.order.deletedAt
    ) {
      throw new NotFoundException('Entrega não encontrada');
    }
    const order = delivery.order;
    const method = dto.method ?? (delivery.method as string);

    let deliveryStatus: string | undefined;
    let shippedAt: Date | undefined;
    let receivedAt: Date | undefined;

    if (dto.setShipped && method !== 'PICKUP') {
      shippedAt = new Date();
      deliveryStatus = 'SHIPPED';
    }
    if (dto.setReceived) {
      if (!['PAID', 'OVERPAID'].includes(order.paymentStatus)) {
        throw new BadRequestException(
          'Pague o saldo antes de marcar como recebido (regra 4.4.1)',
        );
      }
      receivedAt = new Date();
      deliveryStatus = 'RECEIVED';
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id: deliveryId },
        data: {
          ...(dto.method !== undefined ? { method: dto.method } : {}),
          ...(dto.recipientName !== undefined
            ? { recipientName: dto.recipientName }
            : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.courierName !== undefined
            ? { courierName: dto.courierName }
            : {}),
          ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(shippedAt ? { shippedAt } : {}),
          ...(receivedAt ? { receivedAt } : {}),
        },
      });
      if (deliveryStatus) {
        await tx.order.update({
          where: { id: order.id },
          data: { deliveryStatus: deliveryStatus as never },
        });
      }
      if (shippedAt) {
        await this.logEvent(
          tx,
          order.id,
          'DELIVERY',
          'Saiu para entrega',
          ownerId,
        );
      }
      if (receivedAt) {
        await this.logEvent(tx, order.id, 'DELIVERY', 'Recebido', ownerId);
      }
    });
    return this.get(ownerId, order.id);
  }

  async removeDelivery(ownerId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, deletedAt: null },
      include: { order: true },
    });
    if (
      !delivery ||
      delivery.order.ownerId !== ownerId ||
      delivery.order.deletedAt
    ) {
      throw new NotFoundException('Entrega não encontrada');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id: deliveryId },
        data: { deletedAt: new Date() },
      });
      await tx.order.update({
        where: { id: delivery.orderId },
        data: { deliveryStatus: 'PENDING' },
      });
      await this.logEvent(
        tx,
        delivery.orderId,
        'DELIVERY',
        'Entrega removida',
        ownerId,
      );
    });
    return this.get(ownerId, delivery.orderId);
  }

  // ---------- consultas ----------

  async list(
    ownerId: string,
    filters: {
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
      deliveryStatus?: string;
      customerId?: string;
      storeId?: string;
      from?: string;
      to?: string;
      done?: boolean;
    },
  ) {
    if (filters.storeId) await this.stores.assertMember(ownerId, filters.storeId);

    // "concluído" = pronto + entregue + pago (regra da aba Concluídos)
    const doneWhere = {
      status: 'READY' as const,
      deliveryStatus: 'RECEIVED' as const,
      paymentStatus: { in: ['PAID', 'OVERPAID'] as PaymentStatus[] },
    };
    const doneFilter =
      filters.done === true
        ? doneWhere
        : filters.done === false
          ? { NOT: doneWhere }
          : {};

    const scheduledFor =
      filters.from || filters.to
        ? {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(filters.to) } : {}),
          }
        : undefined;

    return this.prisma.order.findMany({
      where: {
        ownerId,
        deletedAt: null,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.paymentStatus ? { paymentStatus: filters.paymentStatus } : {}),
        ...(filters.deliveryStatus
          ? { deliveryStatus: filters.deliveryStatus as never }
          : {}),
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.storeId
          ? { items: { some: { storeId: filters.storeId, deletedAt: null } } }
          : {}),
        ...(scheduledFor ? { scheduledFor } : {}),
        ...doneFilter,
      },
      include: {
        items: { where: { deletedAt: null }, include: { options: true } },
        customer: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(ownerId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, ownerId, deletedAt: null },
      include: {
        items: { where: { deletedAt: null }, include: { options: true } },
        payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' } },
        deliveries: { where: { deletedAt: null } },
        customer: true,
        owner: { select: { id: true, name: true, email: true } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado');
    return order;
  }
}
