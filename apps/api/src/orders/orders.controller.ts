import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderDto, UpdateStatusDto } from './orders.dto';
import type { OrderStatus, PaymentStatus } from '../generated/prisma/enums';

@UseGuards(AuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: OrderStatus,
    @Query('payment_status') paymentStatus?: PaymentStatus,
    @Query('delivery_status') deliveryStatus?: string,
    @Query('customer') customerId?: string,
    @Query('store_id') storeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('done') done?: string,
  ) {
    return this.orders.list(user.id, {
      status,
      paymentStatus,
      deliveryStatus,
      customerId,
      storeId,
      from,
      to,
      done: done === 'true' ? true : done === 'false' ? false : undefined,
    });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.get(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.orders.update(user.id, id, dto);
  }

  @Patch(':id/status')
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.orders.changeStatus(user.id, id, dto.status);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.remove(user.id, id);
  }
}
