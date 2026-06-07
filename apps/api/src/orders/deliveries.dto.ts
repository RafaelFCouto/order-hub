import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { DeliveryMethod } from '../generated/prisma/enums';

export class CreateDeliveryDto {
  @IsEnum(DeliveryMethod)
  method!: DeliveryMethod;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  courierName?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateDeliveryDto {
  @IsOptional()
  @IsEnum(DeliveryMethod)
  method?: DeliveryMethod;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  courierName?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Atalhos: setam shipped_at/received_at no server e movem delivery_status. */
  @IsOptional()
  @IsBoolean()
  setShipped?: boolean;

  @IsOptional()
  @IsBoolean()
  setReceived?: boolean;
}
