import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Subconjunto do client (tx ou prisma) que o StockService usa. */
type Tx = Pick<PrismaService, 'product' | 'stockMovement' | 'productHistory'>;

interface ItemMove {
  productId: string;
  quantity: number;
  orderItemId?: string | null;
}

export interface StockWarning {
  name: string;
  stock: number;
}

@Injectable()
export class StockService {
  /** Baixa de venda: -qty por item. Não bloqueia (estoque pode ficar < 0). */
  async sale(
    tx: Tx,
    items: ItemMove[],
    actorId: string,
  ): Promise<StockWarning[]> {
    const warnings: StockWarning[] = [];
    for (const it of items) {
      const product = await tx.product.findUnique({
        where: { id: it.productId },
      });
      if (!product || product.stock === null) continue; // não controla estoque
      const novo = product.stock - it.quantity;
      await tx.product.update({
        where: { id: product.id },
        data: { stock: novo },
      });
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          orderItemId: it.orderItemId ?? null,
          qtyChange: -it.quantity,
          reason: 'SALE',
        },
      });
      await tx.productHistory.create({
        data: {
          productId: product.id,
          eventType: 'STOCK_SALE',
          field: 'stock',
          oldValue: product.stock,
          newValue: novo,
          qtyChange: -it.quantity,
          orderItemId: it.orderItemId ?? null,
          actorId,
          note: novo < 0 ? 'estoque ficou negativo' : null,
        },
      });
      if (novo < 0) warnings.push({ name: product.name, stock: novo });
    }
    return warnings;
  }

  /** Devolução (cancelamento/ajuste): +qty por item. */
  async restock(tx: Tx, items: ItemMove[], actorId: string): Promise<void> {
    for (const it of items) {
      const product = await tx.product.findUnique({
        where: { id: it.productId },
      });
      if (!product || product.stock === null) continue;
      const novo = product.stock + it.quantity;
      await tx.product.update({
        where: { id: product.id },
        data: { stock: novo },
      });
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          orderItemId: it.orderItemId ?? null,
          qtyChange: it.quantity,
          reason: 'CANCEL_RETURN',
        },
      });
      await tx.productHistory.create({
        data: {
          productId: product.id,
          eventType: 'STOCK_RETURN',
          field: 'stock',
          oldValue: product.stock,
          newValue: novo,
          qtyChange: it.quantity,
          orderItemId: it.orderItemId ?? null,
          actorId,
        },
      });
    }
  }

  /** Auditoria de mudança de preço. */
  async priceChange(
    tx: Tx,
    productId: string,
    oldPrice: number,
    newPrice: number,
    actorId: string,
  ): Promise<void> {
    await tx.productHistory.create({
      data: {
        productId,
        eventType: 'PRICE_CHANGE',
        field: 'price',
        oldValue: oldPrice,
        newValue: newPrice,
        actorId,
      },
    });
  }

  /** Ajuste manual de estoque (edição do produto). */
  async manualAdjust(
    tx: Tx,
    productId: string,
    oldStock: number,
    newStock: number,
    actorId: string,
  ): Promise<void> {
    const delta = newStock - oldStock;
    await tx.stockMovement.create({
      data: { productId, qtyChange: delta, reason: 'ADJUST' },
    });
    await tx.productHistory.create({
      data: {
        productId,
        eventType: 'STOCK_ADJUST',
        field: 'stock',
        oldValue: oldStock,
        newValue: newStock,
        qtyChange: delta,
        actorId,
      },
    });
  }
}
