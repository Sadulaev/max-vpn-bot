import { Controller, Get, NotFoundException, Res, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import type { Response } from 'express';

const ALLOWED_ASSETS = new Set([
  'logo.png',
  'privacy-policy.pdf',
  'user-agreements.pdf',
]);

@ApiTags('Assets')
@Controller()
export class AssetsController {
  @Get('logo.png')
  @ApiOperation({ summary: 'Публичный логотип HIT VPN (PNG)' })
  getLogo(@Res() res: Response): void {
    this.sendAsset(res, 'logo.png', 'image/png');
  }

  @Get('assets/:filename')
  @ApiOperation({ summary: 'Публичные файлы из /assets (PDF и др.)' })
  getAsset(@Param('filename') filename: string, @Res() res: Response): void {
    const safe = basename(filename);
    if (!ALLOWED_ASSETS.has(safe)) {
      throw new NotFoundException('Asset not found');
    }
    const contentType = safe.endsWith('.pdf')
      ? 'application/pdf'
      : safe.endsWith('.png')
        ? 'image/png'
        : 'application/octet-stream';
    this.sendAsset(res, safe, contentType);
  }

  private sendAsset(res: Response, filename: string, contentType: string): void {
    const filePath = join(process.cwd(), 'assets', filename);
    if (!existsSync(filePath)) {
      throw new NotFoundException('Asset not found');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(filePath);
  }
}
