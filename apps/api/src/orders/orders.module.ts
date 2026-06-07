import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { PaymentsController } from './payments.controller';
import { OrdersService } from './orders.service';
import { StoresModule } from '../stores/stores.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [StoresModule, CustomersModule],
  controllers: [OrdersController, PaymentsController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
