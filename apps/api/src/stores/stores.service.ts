import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.guard';
import { CreateStoreDto, UpdateStoreDto } from './dto';

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lojas em que o usuário é membro (não deletadas). */
  async listForUser(userId: string) {
    const members = await this.prisma.storeMember.findMany({
      where: { userId, store: { deletedAt: null } },
      include: { store: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({ ...m.store, role: m.role }));
  }

  async me(user: AuthUser) {
    const stores = await this.listForUser(user.id);
    return { user, stores };
  }

  async create(user: AuthUser, dto: CreateStoreDto) {
    await this.assertNameFree(user.id, dto.name);
    const slug = await this.uniqueSlug(dto.name);
    return this.prisma.store.create({
      data: {
        name: dto.name,
        cnpj: dto.cnpj,
        phone: dto.phone,
        slug,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
  }

  async update(user: AuthUser, storeId: string, dto: UpdateStoreDto) {
    await this.assertMember(user.id, storeId, true);
    if (dto.name) await this.assertNameFree(user.id, dto.name, storeId);
    return this.prisma.store.update({
      where: { id: storeId },
      data: { name: dto.name, cnpj: dto.cnpj, phone: dto.phone },
    });
  }

  /** Impede duas lojas do mesmo dono com o mesmo nome (case-insensitive). */
  private async assertNameFree(
    userId: string,
    name: string,
    exceptId?: string,
  ) {
    const stores = await this.listForUser(userId);
    const target = name.trim().toLowerCase();
    const clash = stores.some(
      (s) => s.id !== exceptId && s.name.trim().toLowerCase() === target,
    );
    if (clash) {
      throw new ConflictException('Já existe uma loja com esse nome');
    }
  }

  /** Garante que o usuário é membro da loja; se requireOwner, exige OWNER. */
  async assertMember(userId: string, storeId: string, requireOwner = false) {
    const member = await this.prisma.storeMember.findUnique({
      where: { storeId_userId: { storeId, userId } },
    });
    if (!member) throw new ForbiddenException('Sem acesso a esta loja');
    if (requireOwner && member.role !== 'OWNER') {
      throw new ForbiddenException('Ação restrita ao dono da loja');
    }
    return member;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'loja';
    let slug = base;
    let n = 1;
    while (await this.prisma.store.findUnique({ where: { slug } })) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }
}
