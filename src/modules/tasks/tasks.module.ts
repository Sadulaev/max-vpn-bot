import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TasksService } from './tasks.service';
import { SubscriptionsModule } from '@modules/subscriptions';
import { PaymentsModule } from '@modules/payments';
import { UserBotModule } from '@modules/bot';
import { Subscription } from '@database/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription]),
    SubscriptionsModule,
    PaymentsModule,
    forwardRef(() => UserBotModule),
  ],
  providers: [TasksService],
})
export class TasksModule {}
