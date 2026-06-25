import { IsString, IsOptional, IsIn, IsArray, IsNumber, IsInt } from 'class-validator';
import { BotButton } from '@database/entities';

export class CreateBotPageDto {
  @IsString()
  key!: string;

  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  text?: string;

  @IsString()
  @IsIn(['none', 'photo', 'video'])
  @IsOptional()
  mediaType?: 'none' | 'photo' | 'video';

  @IsArray()
  @IsOptional()
  buttons?: BotButton[][];

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsString()
  @IsOptional()
  description?: string;
}
