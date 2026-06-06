import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from './supabase.service';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface CacheEntry {
  user: AuthUser;
  exp: number;
}

/**
 * Valida o JWT do Supabase (Authorization: Bearer ...) e garante a linha
 * em `app_user`. Anexa o usuário em req.user. Cache curto por token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 60_000;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Token ausente');

    const user = await this.resolveUser(token);
    (req as Request & { user: AuthUser }).user = user;
    return true;
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7).trim() || null;
  }

  private async resolveUser(token: string): Promise<AuthUser> {
    const cached = this.cache.get(token);
    if (cached && cached.exp > Date.now()) return cached.user;

    if (!this.supabase.client) {
      throw new UnauthorizedException(
        'Auth não configurada (defina SUPABASE_URL e SUPABASE_ANON_KEY)',
      );
    }
    const { data, error } = await this.supabase.client.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException('Token inválido');
    }

    const sb = data.user;
    const name =
      (sb.user_metadata?.name as string | undefined) ??
      sb.email?.split('@')[0] ??
      'Usuário';

    // upsert do espelho local (app_user)
    const user = await this.prisma.user.upsert({
      where: { id: sb.id },
      update: { email: sb.email ?? '' },
      create: { id: sb.id, email: sb.email ?? '', name },
    });

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
    };
    this.cache.set(token, { user: authUser, exp: Date.now() + this.ttlMs });
    return authUser;
  }
}
