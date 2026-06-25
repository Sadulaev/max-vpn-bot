import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Response } from 'express';
import * as fs from 'fs';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '@modules/auth/jwt-auth.guard';
import { BotPagesService } from './bot-pages.service';
import { CreateBotPageDto } from './dto/create-bot-page.dto';
import { UpdateBotPageDto } from './dto/update-bot-page.dto';

@ApiTags('BotPages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bot-pages')
export class BotPagesController {
  constructor(private readonly botPagesService: BotPagesService) {}

  @Get()
  findAll() {
    return this.botPagesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.botPagesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateBotPageDto) {
    return this.botPagesService.create(dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBotPageDto,
  ) {
    return this.botPagesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.botPagesService.remove(id);
  }

  /** Загрузка медиафайла для страницы */
  @Post(':id/media')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, _file, cb) => {
          const uploadsDir = join(process.cwd(), 'uploads', 'bot-pages');
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
          cb(null, uploadsDir);
        },
        filename: (_req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|mov|avi)$/i;
        if (!allowed.test(extname(file.originalname))) {
          return cb(new BadRequestException('Разрешены только изображения и видео'), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    }),
  )
  async uploadMedia(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('mediaType') mediaType: string,
  ) {
    if (!file) throw new BadRequestException('Файл не прикреплён');
    const type = (mediaType === 'video' ? 'video' : 'photo') as 'photo' | 'video';
    return this.botPagesService.updateMedia(id, file, type);
  }

  /** Удаление медиафайла */
  @Delete(':id/media')
  removeMedia(@Param('id', ParseIntPipe) id: number) {
    return this.botPagesService.removeMedia(id);
  }

  /** Отдача медиафайла (для предпросмотра в панели управления) */
  @Get(':id/media/file')
  @UseGuards() // убираем гард для отдачи файла
  async serveMedia(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const page = await this.botPagesService.findOne(id);
    if (!page.mediaPath || !fs.existsSync(page.mediaPath)) {
      return res.status(404).send('Media not found');
    }
    return res.sendFile(page.mediaPath, { root: '/' });
  }

  /** Изменить порядок страниц */
  @Patch('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body('ids') ids: number[]) {
    return this.botPagesService.reorder(ids);
  }
}
