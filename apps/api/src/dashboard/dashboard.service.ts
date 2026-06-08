import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoresService } from '../stores/stores.service';

export interface DashboardSummary {
  ordersToday: number;
  pickupsToday: number;
  monthRevenue: number;
  revenueByStore: { storeId: string; storeName: string; total: number }[];
  receivable: number;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
  ) {}

  async summary(ownerId: string, storeId?: string): Promise<DashboardSummary> {
    if (storeId) await this.stores.assertMember(ownerId, storeId);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const storeItemsFilter = storeId
      ? { items: { some: { storeId, deletedAt: null } } }
      : {};

    const [ordersToday, pickupsToday, grouped, receivableAgg] =
      await Promise.all([
        this.prisma.order.count({
          where: {
            ownerId,
            deletedAt: null,
            createdAt: { gte: todayStart, lt: tomorrow },
            ...storeItemsFilter,
          },
        }),
        this.prisma.order.count({
          where: {
            ownerId,
            deletedAt: null,
            status: { not: 'CANCELED' },
            scheduledFor: { gte: todayStart, lt: tomorrow },
            ...storeItemsFilter,
          },
        }),
        this.prisma.orderItem.groupBy({
          by: ['storeId'],
          where: {
            deletedAt: null,
            ...(storeId ? { storeId } : {}),
            order: {
              ownerId,
              deletedAt: null,
              createdAt: { gte: monthStart },
            },
          },
          _sum: { lineTotal: true },
        }),
        this.prisma.order.aggregate({
          where: {
            ownerId,
            deletedAt: null,
            status: { not: 'CANCELED' },
            balanceDue: { gt: 0 },
            ...storeItemsFilter,
          },
          _sum: { balanceDue: true },
        }),
      ]);

    const storeIds = grouped.map((g) => g.storeId);
    const storeRows = await this.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, name: true },
    });
    const nameOf = (id: string) =>
      storeRows.find((s) => s.id === id)?.name ?? 'Loja';

    const revenueByStore = grouped
      .map((g) => ({
        storeId: g.storeId,
        storeName: nameOf(g.storeId),
        total: Number(g._sum.lineTotal ?? 0),
      }))
      .sort((a, b) => b.total - a.total);

    const monthRevenue = revenueByStore.reduce((s, r) => s + r.total, 0);

    return {
      ordersToday,
      pickupsToday,
      monthRevenue,
      revenueByStore,
      receivable: Number(receivableAgg._sum.balanceDue ?? 0),
    };
  }
}
