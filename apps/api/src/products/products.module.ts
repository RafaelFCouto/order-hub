import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StoresModule } from '../stores/stores.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [StoresModule, StockModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
