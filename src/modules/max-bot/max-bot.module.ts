import { Module } from '@nestjs/common';
import { UserBotModule } from '@modules/bot';
import { MaxApiModule } from '@modules/max-api';
import { MaxBotController } from './max-bot.controller';
import { MaxBotService } from './max-bot.service';

@Module({
  imports: [UserBotModule, MaxApiModule],
  controllers: [MaxBotController],
  providers: [MaxBotService],
  exports: [MaxBotService],
})
export class MaxBotModule {}