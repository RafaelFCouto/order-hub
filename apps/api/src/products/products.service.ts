import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoresService } from '../stores/stores.service';
import { StockService } from '../stock/stock.service';
import {
  CreateCategoryDto,
  CreateProductDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
    private readonly stock: StockService,
  ) {}

  // ---------- categorias ----------
  async listCategories(userId: string, storeId: string, includeDeleted = false) {
    await this.stores.assertMember(userId, storeId);
    return this.prisma.productCategory.findMany({
      where: { storeId, ...(includeDeleted ? {} : { deletedAt: null }) },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(userId: string, dto: CreateCategoryDto) {
    await this.stores.assertMember(userId, dto.storeId);
    return this.prisma.productCategory.create({ data: dto });
  }

  private async assertCategory(userId: string, id: string) {
    const cat = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Categoria não encontrada');
    await this.stores.assertMember(userId, cat.storeId);
    return cat;
  }

  async updateCategory(userId: string, id: string, dto: UpdateCategoryDto) {
    await this.assertCategory(userId, id);
    return this.prisma.productCategory.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.active === undefined
          ? {}
          : dto.active
            ? { deletedAt: null, deletedUserId: null } // reativa
            : { deletedAt: new Date(), deletedUserId: userId }), // soft-delete
        updatedUserId: userId,
      },
    });
  }

  /** Soft-delete: marca deletedAt/quem e solta os produtos (categoryId = null). */
  async removeCategory(userId: string, id: string) {
    await this.assertCategory(userId, id);
    await this.prisma.$transaction([
      this.prisma.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
      }),
      this.prisma.productCategory.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedUserId: userId,
          updatedUserId: userId,
        },
      }),
    ]);
    return { ok: true };
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
    const current = await this.get(userId, id); // valida acesso + estado atual
    const oldPrice = Number(current.price);
    const oldStock = current.stock;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data: dto });

      if (dto.price !== undefined && Number(dto.price) !== oldPrice) {
        await this.stock.priceChange(tx, id, oldPrice, Number(dto.price), userId);
      }
      if (
        dto.stock !== undefined &&
        dto.stock !== null &&
        oldStock !== null &&
        dto.stock !== oldStock
      ) {
        await this.stock.manualAdjust(tx, id, oldStock, dto.stock, userId);
      }
      return updated;
    });
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
