import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';

@Injectable()
export class TelegrafErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TelegrafErrorInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        this.logger.error('Telegraf error:', error?.message || error);
        return throwError(() => error);
      }),
    );
  }
}

