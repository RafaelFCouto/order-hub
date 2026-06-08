import type { PrismaClient } from '../generated/prisma-test/client';

/** Limpa todas as tabelas em ordem segura de FK (filhos -> pais). */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.productHistory.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.orderItemOption.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productCategory.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.storeMember.deleteMany();
  await prisma.store.deleteMany();
  await prisma.user.deleteMany();
}
