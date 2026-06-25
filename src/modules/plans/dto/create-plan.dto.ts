import { IsString, IsNumber, IsOptional, IsBoolean, IsIn, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlanDto {
  @ApiProperty({ enum: ['standard', 'anti-throttling'], description: 'Тип подписки' })
  @IsIn(['standard', 'anti-throttling'])
  planType!: 'standard' | 'anti-throttling';

  @ApiProperty({ description: 'Название тарифа (показывается в боте)' })
  @IsString()
  label!: string;

  @ApiProperty({ description: 'Количество месяцев (для Базового). Для Антиглушилка указывайте 0.' })
  @IsNumber()
  @Min(0)
  months!: number;

  @ApiProperty({ description: 'Цена в рублях' })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ description: 'Лимит трафика в ГБ (0 = безлимит). Для Антиглушилка > 0.' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  dataLimitGB?: number;

  @ApiPropertyOptional({ description: 'Описание тарифа' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0, description: 'Порядок сортировки (меньше — выше)' })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ default: true, description: 'Основная подписка (true = Базовый/Антиглушилка) или дополнительная (false)' })
  @IsBoolean()
  @IsOptional()
  isMain?: boolean;
}
