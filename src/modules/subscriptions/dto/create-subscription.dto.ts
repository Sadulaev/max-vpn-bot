import { IsString, IsOptional, IsInt, IsNumber, Min, Max, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionSource } from '@database/entities';

export class CreateSubscriptionDto {
  /** Telegram ID клиента */
  @ApiPropertyOptional({ 
    example: '123456789', 
    description: 'Telegram ID клиента (опционально)' 
  })
  @IsString()
  @IsOptional()
  telegramId?: string;

  /** Период подписки в днях */
  @ApiProperty({ example: 30, description: 'Период подписки в днях (1-365)', minimum: 1, maximum: 365 })
  @IsInt()
  @Min(1)
  @Max(365)
  days!: number;

  /** Источник создания подписки */
  @ApiPropertyOptional({ 
    enum: SubscriptionSource, 
    example: SubscriptionSource.ADMIN, 
    description: 'Источник создания (админка или бот)',
    default: SubscriptionSource.ADMIN 
  })
  @IsEnum(SubscriptionSource)
  @IsOptional()
  source?: SubscriptionSource;

  /** Примечание к подписке */
  @ApiPropertyOptional({ 
    example: 'Тестовый пользователь', 
    description: 'Примечание к подписке (опционально)' 
  })
  @IsString()
  @IsOptional()
  note?: string;

  /** Лимит трафика в GB (0 = безлимит) */
  @ApiPropertyOptional({ 
    example: 100, 
    description: 'Лимит трафика в GB (0 = безлимит)' 
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  dataLimitGB?: number;

  /** JSON конфигурация proxies */
  @ApiPropertyOptional({ 
    example: '{"vless":{}}', 
    description: 'JSON конфигурация proxies' 
  })
  @IsString()
  @IsOptional()
  proxiesConfig?: string;

  /** JSON конфигурация inbounds */
  @ApiPropertyOptional({ 
    example: '{}', 
    description: 'JSON конфигурация inbounds' 
  })
  @IsString()
  @IsOptional()
  inboundsConfig?: string;

  /** Telegram ID пригласившего пользователя (реферер) */
  @ApiPropertyOptional({ example: '987654321', description: 'Telegram ID реферера' })
  @IsString()
  @IsOptional()
  referrerId?: string;

  /** Является ли подписка дополнительной (не основной Базовый/Антиглушилка) */
  @ApiPropertyOptional({ default: false, description: 'Дополнительная подписка' })
  @IsOptional()
  isAdditional?: boolean;
}
