import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksService } from './tasks.service';
import { SubscriptionsModule } from '@modules/subscriptions';
import { PaymentsModule } from '@modules/payments';
import { MaxApiModule } from '@modules/max-api';
import { Subscription } from '@database/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription]),
    SubscriptionsModule,
    PaymentsModule,
    MaxApiModule,
  ],
  providers: [TasksService],
})
export class TasksModule {}
