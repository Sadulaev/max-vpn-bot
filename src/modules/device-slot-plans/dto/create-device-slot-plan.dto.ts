import { IsString, IsInt, IsBoolean, IsOptional, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDeviceSlotPlanDto {
  @ApiProperty({ example: '+1 устройство' })
  @IsString()
  @MaxLength(255)
  label!: string;

  @ApiProperty({ example: 1, description: 'Количество добавляемых слотов' })
  @IsInt()
  @Min(1)
  slotsCount!: number;

  @ApiProperty({ example: 150, description: 'Цена в рублях' })
  @IsInt()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
