import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoresService } from '../stores/stores.service';
import { CustomersService } from '../customers/customers.service';
import {
  DiscountType,
  OrderStatus,
  PaymentStatus,
} from '../generated/prisma/enums';
import { CreateOrderDto, OrderItemInput, UpdateOrderDto } from './orders.dto';
import { CreatePaymentDto } from './payments.dto';

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

interface BuiltItem {
  productId: string;
  storeId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
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
      built.push({
        productId: product.id,
        storeId: product.storeId,
        productName: product.name,
        unitPrice,
        quantity: item.quantity,
        lineTotal: money(unitPrice * item.quantity),
      });
    }
    return built;
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
      include: { items: { where: { deletedAt: null } } },
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
    const paymentStatus = this.derivePaymentStatus(0, t.total);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          ownerId,
          customerId: dto.customerId,
          status: 'PENDING',
          paymentStatus,
          deliveryStatus: 'PENDING',
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
          itemsTotal: t.itemsTotal,
          discountType,
          discountValue,
          discountAmount: t.discountAmount,
          hasStoreDiscount: t.hasStoreDiscount,
          overrideValue: t.overrideValue,
          deliveryFee,
          total: t.total,
          paidTotal: 0,
          balanceDue: t.total,
          notes: dto.notes,
          items: { create: items },
        },
        include: { items: true },
      });
      await this.bumpCustomer(tx, dto.customerId, t.total, 1);
      return order;
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
        await tx.orderItem.updateMany({
          where: { orderId: id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        await tx.orderItem.createMany({
          data: items.map((i) => ({ ...i, orderId: id })),
        });
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
    return this.prisma.order.update({
      where: { id },
      data: { status: next },
      include: { items: { where: { deletedAt: null } } },
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
      await this.bumpCustomer(tx, order.customerId, -Number(order.total), -1);
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
    },
  ) {
    if (filters.storeId) await this.stores.assertMember(ownerId, filters.storeId);

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
      },
      include: {
        items: { where: { deletedAt: null } },
        customer: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(ownerId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, ownerId, deletedAt: null },
      include: {
        items: { where: { deletedAt: null } },
        payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' } },
        deliveries: { where: { deletedAt: null } },
        customer: true,
        owner: { select: { id: true, name: true, email: true } },
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado');
    return order;
  }
}
