import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Res,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '@modules/auth';
import { BotPage, MediaType } from '@database/entities';

const UPLOAD_DIR = join(process.cwd(), 'assets', 'bot-pages');

function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

@ApiTags('Bot Pages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bot-pages')
export class BotPagesController {
  constructor(
    @InjectRepository(BotPage)
    private readonly repo: Repository<BotPage>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Получить все страницы бота' })
  findAll() {
    return this.repo.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  @Get('reorder')
  // placeholder to avoid route collision – reorder is a PATCH below
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  reorderGet() {
    return;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить страницу бота по ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const page = await this.repo.findOne({ where: { id } });
    if (!page) throw new NotFoundException(`BotPage #${id} not found`);
    return page;
  }

  @Post()
  @ApiOperation({ summary: 'Создать страницу бота' })
  async create(@Body() dto: Partial<BotPage>) {
    const page = this.repo.create({
      key: dto.key!,
      title: dto.title!,
      text: dto.text ?? '',
      description: dto.description ?? null,
      mediaType: dto.mediaType ?? 'none',
      buttons: dto.buttons ?? [],
      sortOrder: dto.sortOrder ?? 0,
    });
    return this.repo.save(page);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Обновить страницу бота' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<BotPage>,
  ) {
    const page = await this.repo.findOne({ where: { id } });
    if (!page) throw new NotFoundException(`BotPage #${id} not found`);
    Object.assign(page, {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.text !== undefined && { text: dto.text }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.mediaType !== undefined && { mediaType: dto.mediaType }),
      ...(dto.buttons !== undefined && { buttons: dto.buttons }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
    });
    return this.repo.save(page);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Изменить порядок страниц' })
  async reorder(@Body() body: { ids: number[] }) {
    const { ids } = body;
    if (!Array.isArray(ids)) throw new BadRequestException('ids must be an array');
    await Promise.all(
      ids.map((id, index) => this.repo.update(id, { sortOrder: index })),
    );
    return this.findAll();
  }

  @Post(':id/media')
  @ApiOperation({ summary: 'Загрузить медиафайл для страницы' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          ensureUploadDir();
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
      fileFilter: (_req, file, cb) => {
        const allowed = /image\/(jpeg|png|gif|webp)|video\/(mp4|mpeg|quicktime|webm)/;
        if (allowed.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Unsupported file type'), false);
        }
      },
    }),
  )
  async uploadMedia(
    @Param('id', ParseIntPipe) id: number,
    @Body('mediaType') mediaType: MediaType,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const page = await this.repo.findOne({ where: { id } });
    if (!page) throw new NotFoundException(`BotPage #${id} not found`);
    if (!file) throw new BadRequestException('No file uploaded');

    // Remove old file if exists
    if (page.mediaPath && existsSync(page.mediaPath)) {
      try { unlinkSync(page.mediaPath); } catch { /* ignore */ }
    }

    page.mediaPath = file.path;
    page.mediaType = (mediaType as MediaType) || 'photo';
    page.mediaTelegramFileId = null;
    return this.repo.save(page);
  }

  @Get(':id/media/file')
  @ApiOperation({ summary: 'Получить медиафайл страницы' })
  async serveMedia(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const page = await this.repo.findOne({ where: { id } });
    if (!page || !page.mediaPath || !existsSync(page.mediaPath)) {
      throw new NotFoundException('Media file not found');
    }
    res.sendFile(page.mediaPath);
  }

  @Delete(':id/media')
  @ApiOperation({ summary: 'Удалить медиафайл страницы' })
  async deleteMedia(@Param('id', ParseIntPipe) id: number) {
    const page = await this.repo.findOne({ where: { id } });
    if (!page) throw new NotFoundException(`BotPage #${id} not found`);

    if (page.mediaPath && existsSync(page.mediaPath)) {
      try { unlinkSync(page.mediaPath); } catch { /* ignore */ }
    }

    page.mediaPath = null;
    page.mediaType = 'none';
    page.mediaTelegramFileId = null;
    return this.repo.save(page);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить страницу бота' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    const page = await this.repo.findOne({ where: { id } });
    if (!page) throw new NotFoundException(`BotPage #${id} not found`);

    if (page.mediaPath && existsSync(page.mediaPath)) {
      try { unlinkSync(page.mediaPath); } catch { /* ignore */ }
    }

    await this.repo.delete(id);
  }
}
