import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  Logger,
  HttpStatus,
  Inject,
  forwardRef,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiParam, ApiResponse, ApiBody, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto, SendMessageDto } from './dto';
import { SubscriptionSource } from '@database/entities';
import { JwtAuthGuard } from '@modules/auth';

// API контроллер для управления подписками (с префиксом /api)
@ApiTags('Subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  private readonly logger = new Logger(SubscriptionsController.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Get()
  @ApiOperation({ 
    summary: 'Поиск подписок', 
    description: 'Возвращает список подписок с фильтрацией и поиском' 
  })
  @ApiQuery({ name: 'search', required: false, description: 'Поиск по clientId или примечанию' })
  @ApiQuery({ name: 'source', required: false, enum: SubscriptionSource, description: 'Фильтр по источнику' })
  @ApiResponse({ status: 200, description: 'Список подписок успешно получен' })
  async getAllSubscriptions(
    @Query('search') search?: string,
    @Query('source') source?: SubscriptionSource,
  ) {
    return this.subscriptionsService.searchEnriched({ search, source });
  }

  @Get('export-csv')
  @ApiOperation({ summary: 'Экспорт подписок в CSV' })
  @ApiResponse({ status: 200, description: 'CSV файл' })
  async exportSubscriptionsCsv(
    @Query('search') search?: string,
    @Query('source') source?: SubscriptionSource,
    @Res() res?: Response,
  ) {
    const subs = await this.subscriptionsService.search({ search, source });

    const fmtDate = (d: any) => {
      if (!d) return '';
      const dt = d instanceof Date ? d : new Date(d);
      if (isNaN(dt.getTime())) return '';
      return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const header = 'ID,Max ID,Дата создания,Количество дней\n';
    const rows = subs.map((s) =>
      [
        s.id,
        s.maxId ?? '',
        fmtDate(s.createdAt),
        s.days,
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );

    const csv = header + rows.join('\n');
    res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res!.setHeader('Content-Disposition', `attachment; filename="subscriptions-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res!.send('\uFEFF' + csv);
  }

  @Get('export-unique-max-ids')
  @ApiOperation({ summary: 'Экспорт уникальных Max ID' })
  @ApiResponse({ status: 200, description: 'CSV файл' })
  async exportUniqueMaxIds(@Res() res?: Response) {
    const subs = await this.subscriptionsService.search({});

    const fmtDate = (d: any) => {
      if (!d) return '';
      const dt = d instanceof Date ? d : new Date(d);
      if (isNaN(dt.getTime())) return '';
      return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    // Находим первую (самую раннюю) подписку для каждого Max ID
    const uniqueMap = new Map<string, { id: string; maxId: string; createdAt: any }>();
    // subs отсортированы DESC, берём последнюю (самую раннюю)
    for (const s of subs) {
      if (!s.maxId) continue;
      if (!uniqueMap.has(s.maxId)) {
        uniqueMap.set(s.maxId, { id: s.id, maxId: s.maxId, createdAt: s.createdAt });
      }
    }

    const header = 'ID,Max ID,Дата создания\n';
    const rows = Array.from(uniqueMap.values()).map((u) =>
      [
        u.id,
        u.maxId,
        fmtDate(u.createdAt),
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );

    const csv = header + rows.join('\n');
    res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res!.setHeader('Content-Disposition', `attachment; filename="unique-max-ids-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res!.send('\uFEFF' + csv);
  }

  @Post()
  @ApiOperation({ summary: 'Создать подписку', description: 'Создаёт подписку и регистрирует пользователя в Remnawave.' })
  @ApiBody({ type: CreateSubscriptionDto })
  @ApiResponse({ 
    status: 201, 
    description: 'Подписка создана', 
    schema: { 
      example: { 
        success: true, 
        data: { 
          subscriptionId: 'uuid', 
          username: '32hexchars',
          subscriptionUrl: 'https://panel.example.com/sub/token',
        } 
      } 
    } 
  })
  async createSubscription(@Body() dto: CreateSubscriptionDto) {
    this.logger.log(`Creating subscription for ${dto.days} days`);
    const result = await this.subscriptionsService.createSubscription(dto);
    return { success: true, data: result };
  }

  @Post('process-expired')
  @ApiOperation({ summary: 'Обработать истёкшие подписки', description: 'Находит все подписки с истёкшим сроком.' })
  @ApiResponse({ status: 200, description: 'Результат обработки' })
  async processExpired() {
    this.logger.log('Processing expired subscriptions...');
    const result = await this.subscriptionsService.processExpiredSubscriptions();
    return { success: true, data: result };
  }

  @Get(':id/url')
  @ApiOperation({ 
    summary: 'Получить URL подписки', 
    description: 'Возвращает полный URL подписки для клиента по ID подписки' 
  })
  @ApiParam({ name: 'id', description: 'ID подписки', example: 'uuid' })
  @ApiResponse({ status: 200, description: 'URL подписки', schema: { example: { success: true, data: { subscriptionUrl: 'http://localhost:3000/sub/client-uuid' } } } })
  async getSubscriptionUrl(@Param('id') id: string) {
    id = id.trim();
    const url = await this.subscriptionsService.getSubscriptionUrl(id);
    
    return {
      success: true,
      data: { subscriptionUrl: url },
    };
  }

  @Post('send-message')
  @UseInterceptors(FileInterceptor('photo'))
  @ApiOperation({ 
    summary: 'Отправить сообщение пользователям', 
    description: 'Отправляет сообщение через MAX бота. Если указан maxId - отправляет одному пользователю, иначе - рассылка всем пользователям из БД. Опционально можно приложить фото (multipart/form-data).' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Результат отправки сообщения (одному пользователю)', 
    schema: { example: { success: true, data: { sent: 1, failed: 0, errors: [] } } } 
  })
  @ApiResponse({ 
    status: 202, 
    description: 'Массовая рассылка запущена в фоне', 
    schema: { example: { success: true, message: 'Message broadcasting started in background. Check server logs for results.' } } 
  })
  async sendMessage(
    @Body('message') message: string,
    @Body('maxId') maxId: string | undefined,
    @UploadedFile() photo?: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    // TODO: реализовать массовую рассылку через очередь (Bull) для всех пользователей, если max id не указан
  }

  @Get('unsynced')
  @ApiOperation({ summary: 'Подписки без Remnawave', description: 'Возвращает подписки с пустым username' })
  @ApiResponse({ status: 200, description: 'Список несинхронизированных подписок' })
  async getUnsyncedSubscriptions() {
    return this.subscriptionsService.getUnsynced();
  }

  @Post('sync')
  @ApiOperation({ summary: 'Синхронизировать подписки с Remnawave', description: 'Создаёт Remnawave-пользователей для всех подписок без username' })
  @ApiResponse({ status: 200, description: 'Результат синхронизации' })
  async syncSubscriptions() {
    this.logger.log('Starting subscription sync...');
    const result = await this.subscriptionsService.syncUnsynced();
    return { success: true, data: result };
  }

  @Post(':id/delete')
  @ApiOperation({ 
    summary: 'Удалить подписку', 
    description: 'Удаляет подписку и клиента со всех серверов (если нет других активных подписок)' 
  })
  @ApiParam({ name: 'id', description: 'ID подписки', example: 'uuid' })
  @ApiResponse({ status: 200, description: 'Подписка удалена' })
  async deleteSubscription(@Param('id') id: string) {
    id = id.trim();
    this.logger.log(`Deleting subscription ${id}`);
    const result = await this.subscriptionsService.deleteSubscription(id);
    
    return {
      success: true,
      data: result,
    };
  }
}
