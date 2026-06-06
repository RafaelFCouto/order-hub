import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoresService } from '../stores/stores.service';
import { CreateCategoryDto, CreateProductDto, UpdateProductDto } from './dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
  ) {}

  // ---------- categorias ----------
  async listCategories(userId: string, storeId: string) {
    await this.stores.assertMember(userId, storeId);
    return this.prisma.productCategory.findMany({
      where: { storeId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(userId: string, dto: CreateCategoryDto) {
    await this.stores.assertMember(userId, dto.storeId);
    return this.prisma.productCategory.create({ data: dto });
  }

  // ---------- produtos ----------
  async list(
    userId: string,
    storeId: string,
    opts: { active?: boolean; categoryId?: string } = {},
  ) {
    await this.stores.assertMember(userId, storeId);
    return this.prisma.product.findMany({
      where: {
        storeId,
        deletedAt: null,
        ...(opts.active === undefined ? {} : { active: opts.active }),
        ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async get(userId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');
    await this.stores.assertMember(userId, product.storeId);
    return product;
  }

  async create(userId: string, dto: CreateProductDto) {
    await this.stores.assertMember(userId, dto.storeId);
    return this.prisma.product.create({
      data: {
        storeId: dto.storeId,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        stock: dto.stock,
        active: dto.active ?? true,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateProductDto) {
    await this.get(userId, id); // valida acesso
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async remove(userId: string, id: string) {
    await this.get(userId, id);
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }
}
