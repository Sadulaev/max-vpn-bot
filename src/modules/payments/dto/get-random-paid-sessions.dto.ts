import { IsInt, Min, Max, IsOptional, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetRandomPaidSessionsDto {
  @ApiProperty({ description: 'Количество случайных записей', minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  @Type(() => Number)
  count!: number;

  @ApiPropertyOptional({ description: 'Дата начала (ISO формат)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Дата окончания (ISO формат)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
