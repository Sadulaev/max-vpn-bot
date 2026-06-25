import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ description: 'Текст сообщения для отправки' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ description: 'Telegram ID для отправки сообщения одному пользователю (опционально, если не указан - всем)' })
  @IsOptional()
  @IsString()
  telegramId?: string;
}
