import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DashboardService } from './dashboard.service';

@UseGuards(AuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(
    @CurrentUser() user: AuthUser,
    @Query('store_id') storeId?: string,
  ) {
    return this.dashboard.summary(user.id, storeId);
  }
}
