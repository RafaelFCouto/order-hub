import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [StoresModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
