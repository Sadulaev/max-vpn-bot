import { Module } from '@nestjs/common';
import { MaxApiService } from './max-api.service';

@Module({
  providers: [MaxApiService],
  exports: [MaxApiService],
})
export class MaxApiModule {}