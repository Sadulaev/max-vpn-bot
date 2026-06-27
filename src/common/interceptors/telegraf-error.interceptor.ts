import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';

/**
 * Глобальный перехватчик ошибок.
 * Логирует все необработанные исключения в пайплайне обработки запросов.
 */
@Injectable()
export class TelegrafErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TelegrafErrorInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        this.logger.error(`Unhandled error: ${message}`, stack);
        return throwError(() => err);
      }),
    );
  }
}
