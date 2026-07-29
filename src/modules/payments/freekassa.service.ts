import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface FreekassaPaymentParams {
  /** Наш invId — используется как MERCHANT_ORDER_ID в FK */
  invId: string;
  amount: number;
  description?: string;
  /** Email плательщика. Если не указан — подставляется noreply@max-vpn.tech */
  email?: string;
  /** max ID плательщика — для формирования email-заглушки */
  maxId?: string;
}

export interface FreekassaPaymentResult {
  /** URL для перехода к оплате */
  url: string;
  /** Внутренний ID заказа FreeKassa (для сопоставления с intid в вебхуке) */
  fkOrderId: string;
}

@Injectable()
export class FreekassaService {
  private readonly logger = new Logger(FreekassaService.name);

  private readonly shopId: number;
  /** Секретное слово 2 — для проверки подписи вебхука */
  private readonly secretWord2: string;
  /** API-ключ — для REST-запросов */
  private readonly apiKey: string;
  /** IP сервера — передаётся в FK */
  private readonly serverIp: string;

  private readonly API_URL = 'https://api.fk.life/v1';
  private readonly CURRENCY = 'RUB';
  private lastNonce = 0;

  constructor(private readonly configService: ConfigService) {
    const fk = this.configService.get('freekassa');
    this.shopId = Number(fk?.shopId) || 0;
    this.secretWord2 = fk?.secretWord2 || '';
    this.apiKey = fk?.apiKey || '';
    this.serverIp = fk?.serverIp || '';
  }

  /**
   * FK требует строго возрастающий nonce.
   * Date.now() может совпасть при быстрых запросах, поэтому делаем монотонный счётчик.
   */
  private nextNonce(): number {
    const now = Date.now();
    this.lastNonce = Math.max(now, this.lastNonce + 1);
    return this.lastNonce;
  }

  /**
   * Создать заказ через API FreeKassa и вернуть URL оплаты и FK orderId.
   *
   * POST https://api.fk.life/v1/orders/create
   */
  async generatePaymentUrl(params: FreekassaPaymentParams): Promise<FreekassaPaymentResult> {
    const { invId, amount, email, maxId } = params;
    const amountStr = amount.toFixed(2);
    const effectiveEmail = email || (maxId ? `${maxId}@max-vpn.tech` : `noreply@max-vpn.tech`);
    const nonce = this.nextNonce();

    const payload: Record<string, any> = {
      shopId: this.shopId,
      nonce,
      i: 44,
      amount: amountStr,
      currency: this.CURRENCY,
      orderId: parseInt(invId),
      email: effectiveEmail,
      lang: 'ru',
    };

    if (this.serverIp) {
      payload.ip = this.serverIp;
    }

    payload.signature = this.buildApiSignature(payload);

    const createOrder = async (currentPayload: Record<string, any>) => {
      const response = await fetch(`${this.API_URL}/orders/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentPayload),
      });
      return (await response.json()) as any;
    };

    let data = await createOrder(payload);

    // Иногда FK отклоняет nonce даже при Date.now(); пробуем 1 ретрай с новым nonce.
    if (data?.type === 'error' && String(data?.message ?? '').includes('same (or bigger) nonce')) {
      const retryNonce = this.nextNonce();
      const retryPayload: Record<string, any> = { ...payload, nonce: retryNonce };
      retryPayload.signature = this.buildApiSignature(retryPayload);
      this.logger.warn(`FK nonce conflict for invId=${invId}, retrying with nonce=${retryNonce}`);
      data = await createOrder(retryPayload);
    }

    if (data.type === 'success' && data.location) {
      this.logger.log(`Order created via API: invId=${invId}, fkOrderId=${data.orderId}`);
      return { url: data.location as string, fkOrderId: String(data.orderId) };
    }

    this.logger.error(`API order creation failed for ${invId}. Response: ${JSON.stringify(data)}`);
    throw new Error(`FreeKassa API error: ${data.message ?? JSON.stringify(data)}`);
  }

  /**
   * Верифицировать подпись вебхука от FreeKassa
   *
   * Формула: MD5(MERCHANT_ID:AMOUNT:secretWord2:MERCHANT_ORDER_ID)
   */
  verifyWebhookSignature(
    merchantId: string,
    amount: string,
    merchantOrderId: string,
    sign: string,
  ): boolean {
    if (!this.secretWord2) {
      this.logger.warn('FreekassaService: secretWord2 is not configured');
      return false;
    }
    const signStr = `${merchantId}:${amount}:${this.secretWord2}:${merchantOrderId}`;
    const expected = crypto.createHash('md5').update(signStr).digest('hex');
    return expected.toLowerCase() === sign.toLowerCase();
  }

  /**
   * Сделать возврат через API FreeKassa
   *
   * POST https://api.fk.life/v1/orders/refund
   * Параметр: paymentId — наш invId (MERCHANT_ORDER_ID)
   */
  async refundOrder(paymentId: string): Promise<{ success: boolean; id?: number; error?: string }> {
    const nonce = this.nextNonce();
    const payload: Record<string, any> = {
      shopId: this.shopId,
      nonce,
      paymentId,
    };
    payload.signature = this.buildApiSignature(payload);

    try {
      const response = await fetch(`${this.API_URL}/orders/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as any;

      if (data.type === 'success') {
        this.logger.log(`Refund successful: paymentId=${paymentId}, refundId=${data.id}`);
        return { success: true, id: data.id };
      }

      this.logger.error(`Refund failed: paymentId=${paymentId}`, data);
      return { success: false, error: JSON.stringify(data) };
    } catch (error) {
      this.logger.error(`Refund request error: paymentId=${paymentId}`, error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Построить подпись для API-запросов
   *
   * Алгоритм: сортируем поля по ключу, конкатенируем значения через «|»,
   * хешируем HMAC-SHA256 с API-ключом.
   */
  private buildApiSignature(data: Record<string, any>): string {
    const sortedValues = Object.keys(data)
      .sort()
      .map((k) => String(data[k]));
    const str = sortedValues.join('|');
    return crypto.createHmac('sha256', this.apiKey).update(str).digest('hex');
  }
}
