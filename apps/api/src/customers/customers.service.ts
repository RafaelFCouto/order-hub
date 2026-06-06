import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Clientes do dono (não deletados), opcionalmente filtrados por busca. */
  async list(ownerId: string, search?: string) {
    return this.prisma.customer.findMany({
      where: {
        ownerId,
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { phone: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async get(ownerId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, ownerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    return customer;
  }

  async create(ownerId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: { ...dto, ownerId },
    });
  }

  async update(ownerId: string, id: string, dto: UpdateCustomerDto) {
    await this.get(ownerId, id);
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  /** Soft delete. */
  async remove(ownerId: string, id: string) {
    await this.get(ownerId, id);
    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }
}
