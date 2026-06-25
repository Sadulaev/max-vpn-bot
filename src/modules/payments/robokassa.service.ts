import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface RobokassaPaymentParams {
  invId: string;
  amount: number;
  description: string;
  orderId: string;
}

@Injectable()
export class RobokassaService {
  private readonly merchantId: string;
  private readonly password1: string;
  private readonly password2: string;
  private readonly testMode: boolean;

  constructor(private readonly configService: ConfigService) {
    const robokassa = this.configService.get('robokassa');
    this.merchantId = robokassa?.merchantId || '';
    this.password1 = robokassa?.password1 || '';
    this.password2 = robokassa?.password2 || '';
    this.testMode = robokassa?.testMode || false;
  }

  /**
   * Сгенерировать URL для оплаты
   */
  generatePaymentUrl(params: RobokassaPaymentParams): string {
    const { invId, amount, description, orderId } = params;

    // Формируем подпись: MerchantLogin:OutSum:InvId:Password1:Shp_order=orderId
    const signatureString = `${this.merchantId}:${amount}:${invId}:${this.password1}:Shp_order=${orderId}`;
    const signature = crypto
      .createHash('md5')
      .update(signatureString)
      .digest('hex');

    const baseUrl = this.testMode
      ? 'https://auth.robokassa.ru/Merchant/Index.aspx'
      : 'https://auth.robokassa.ru/Merchant/Index.aspx';

    const urlParams = new URLSearchParams({
      MerchantLogin: this.merchantId,
      OutSum: amount.toString(),
      InvId: invId,
      Description: description,
      SignatureValue: signature,
      Shp_order: orderId,
      ...(this.testMode && { IsTest: '1' }),
    });

    return `${baseUrl}?${urlParams.toString()}`;
  }

  /**
   * Верифицировать подпись от Robokassa (ResultURL)
   * Формула: MD5(OutSum:InvId:Password2:Shp_order=orderId)
   */
  verifyResultSignature(
    outSum: string,
    invId: string,
    signatureValue: string,
    shpOrder: string,
  ): boolean {
    const signatureString = `${outSum}:${invId}:${this.password2}:Shp_order=${shpOrder}`;
    const expectedSignature = crypto
      .createHash('md5')
      .update(signatureString)
      .digest('hex')
      .toUpperCase();

    return expectedSignature === signatureValue.toUpperCase();
  }

  /**
   * Верифицировать подпись от Robokassa (SuccessURL)
   * Формула: MD5(OutSum:InvId:Password1:Shp_order=orderId)
   */
  verifySuccessSignature(
    outSum: string,
    invId: string,
    signatureValue: string,
    shpOrder: string,
  ): boolean {
    const signatureString = `${outSum}:${invId}:${this.password1}:Shp_order=${shpOrder}`;
    const expectedSignature = crypto
      .createHash('md5')
      .update(signatureString)
      .digest('hex')
      .toUpperCase();

    return expectedSignature === signatureValue.toUpperCase();
  }
}

