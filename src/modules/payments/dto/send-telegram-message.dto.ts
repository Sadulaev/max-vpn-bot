import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendTelegramMessageDto {
  @ApiProperty({ description: 'Telegram ID получателя' })
  @IsString()
  @IsNotEmpty()
  telegramId!: string;

  @ApiProperty({ description: 'Текст сообщения' })
  @IsString()
  @IsNotEmpty()
  message!: string;
}
