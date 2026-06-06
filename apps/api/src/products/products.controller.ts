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
import { ProductsService } from './products.service';
import { CreateCategoryDto, CreateProductDto, UpdateProductDto } from './dto';

@UseGuards(AuthGuard)
@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  // ---------- categorias ----------
  @Get('categories')
  listCategories(
    @CurrentUser() user: AuthUser,
    @Query('store_id') storeId: string,
  ) {
    return this.products.listCategories(user.id, storeId);
  }

  @Post('categories')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.products.createCategory(user.id, dto);
  }

  // ---------- produtos ----------
  @Get('products')
  list(
    @CurrentUser() user: AuthUser,
    @Query('store_id') storeId: string,
    @Query('active') active?: string,
    @Query('category_id') categoryId?: string,
  ) {
    return this.products.list(user.id, storeId, {
      active: active === undefined ? undefined : active === 'true',
      categoryId,
    });
  }

  @Get('products/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.get(user.id, id);
  }

  @Post('products')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.products.create(user.id, dto);
  }

  @Patch('products/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(user.id, id, dto);
  }

  @Delete('products/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.remove(user.id, id);
  }
}
