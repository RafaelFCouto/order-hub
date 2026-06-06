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

    return this.prisma.order.create({
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
      return tx.order.update({
        where: { id },
        data: {
          customerId: dto.customerId ?? order.customerId,
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
    await this.loadOwned(ownerId, id);
    await this.prisma.order.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CANCELED' },
    });
    return { ok: true };
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
        payments: { where: { deletedAt: null } },
        deliveries: { where: { deletedAt: null } },
        customer: true,
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado');
    return order;
  }
}
