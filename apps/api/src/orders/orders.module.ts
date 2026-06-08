import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { PaymentsController } from './payments.controller';
import { DeliveriesController } from './deliveries.controller';
import { OrdersService } from './orders.service';
import { StoresModule } from '../stores/stores.module';
import { CustomersModule } from '../customers/customers.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [StoresModule, CustomersModule, StockModule],
  controllers: [OrdersController, PaymentsController, DeliveriesController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
