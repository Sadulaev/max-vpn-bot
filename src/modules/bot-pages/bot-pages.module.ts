import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { BotPage } from '@database/entities';
import { BotPagesController } from './bot-pages.controller';
import { BotPagesService } from './bot-pages.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BotPage]),
    MulterModule.register({}),
  ],
  controllers: [BotPagesController],
  providers: [BotPagesService],
  exports: [BotPagesService],
})
export class BotPagesModule {}
