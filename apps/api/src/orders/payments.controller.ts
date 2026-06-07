import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreatePaymentDto } from './payments.dto';

@UseGuards(AuthGuard)
@Controller()
export class PaymentsController {
  constructor(private readonly orders: OrdersService) {}

  @Post('orders/:id/payments')
  add(
    @CurrentUser() user: AuthUser,
    @Param('id') orderId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.orders.addPayment(user.id, orderId, dto);
  }

  @Delete('payments/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.removePayment(user.id, id);
  }
}
