import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsIn } from 'class-validator';
import { SantaChatService, ChatMessage, ChatLanguage } from './santa-chat.service';

class SendMessageDto {
  @IsString()
  sessionId!: string;

  @IsString()
  message!: string;

  @IsOptional()
  @IsArray()
  history?: ChatMessage[];

  @IsOptional()
  @IsIn(['ru', 'en'])
  language?: ChatLanguage;
}

@ApiTags('Santa Chat')
@Controller('santa-chat')
export class SantaChatController {
  constructor(private readonly santaChatService: SantaChatService) {}

  @Get('session')
  @ApiOperation({ summary: 'Get or create a chat session' })
  async getSession(@Query('sessionId') sessionId?: string) {
    return this.santaChatService.getOrCreateSession(sessionId);
  }

  @Post('message')
  @ApiOperation({ summary: 'Send a message to Santa / Дед Мороз' })
  async sendMessage(@Body() dto: SendMessageDto) {
    return this.santaChatService.sendMessage(
      dto.sessionId,
      dto.message,
      dto.history || [],
      dto.language || 'ru',
    );
  }

  @Get('flow')
  @ApiOperation({ summary: 'Get current flow info (santa/en or ded-moroz/ru)' })
  @ApiQuery({ name: 'language', enum: ['ru', 'en'], required: false })
  getFlow(@Query('language') language?: string) {
    const lang: ChatLanguage = language === 'en' ? 'en' : 'ru';
    return this.santaChatService.getFlow(lang);
  }
}
