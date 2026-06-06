import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { StoresService } from './stores.service';
import { CreateStoreDto, UpdateStoreDto } from './dto';

@UseGuards(AuthGuard)
@Controller()
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.stores.me(user);
  }

  @Get('stores')
  list(@CurrentUser() user: AuthUser) {
    return this.stores.listForUser(user.id);
  }

  @Post('stores')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStoreDto) {
    return this.stores.create(user, dto);
  }

  @Patch('stores/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateStoreDto,
  ) {
    return this.stores.update(user, id, dto);
  }
}
