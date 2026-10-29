import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotState } from '@database/entities';
import { MaxApiModule } from '@modules/max-api';
import { BotTokensService } from './bot-tokens.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([BotState]), MaxApiModule],
  providers: [BotTokensService],
  exports: [BotTokensService],
})
export class BotTokensModule {}
