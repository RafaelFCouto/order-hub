import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreateDeliveryDto, UpdateDeliveryDto } from './deliveries.dto';

@UseGuards(AuthGuard)
@Controller()
export class DeliveriesController {
  constructor(private readonly orders: OrdersService) {}

  @Post('orders/:id/deliveries')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') orderId: string,
    @Body() dto: CreateDeliveryDto,
  ) {
    return this.orders.createDelivery(user.id, orderId, dto);
  }

  @Patch('deliveries/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryDto,
  ) {
    return this.orders.updateDelivery(user.id, id, dto);
  }

  @Delete('deliveries/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.removeDelivery(user.id, id);
  }
}
