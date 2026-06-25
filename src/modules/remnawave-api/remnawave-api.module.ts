import { Module } from '@nestjs/common';
import { RemnawaveApiService } from './remnawave-api.service';

@Module({
  providers: [RemnawaveApiService],
  exports: [RemnawaveApiService],
})
export class RemnawaveApiModule {}
