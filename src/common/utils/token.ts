/**
 * Short self-contained access token.
 * Format: base62(5_bytes_telegramId + 4_bytes_hmac) → 13 chars
 * No DB lookup required for validation.
 */
import { createHmac, timingSafeEqual } from 'crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TOKEN_BYTES = 9;  // 5 id + 4 sig
const TOKEN_LEN = 13;   // ceil(log62(256^9)) = 13

function encodeBase62(buf: Buffer): string {
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  const chars: string[] = [];
  do {
    chars.unshift(BASE62[Number(n % 62n)]);
    n /= 62n;
  } while (n > 0n);
  while (chars.length < TOKEN_LEN) chars.unshift('0');
  return chars.join('');
}

function decodeBase62(s: string): Buffer {
  let n = 0n;
  for (const c of s) {
    const i = BASE62.indexOf(c);
    if (i === -1) throw new Error('invalid char');
    n = n * 62n + BigInt(i);
  }
  const hex = n.toString(16).padStart(TOKEN_BYTES * 2, '0');
  return Buffer.from(hex, 'hex');
}

/**
 * Generate a 13-char token for the given Telegram user ID.
 * secret should be the bot token or app secret.
 */
export function generateAccessToken(telegramId: string, secret: string): string {
  const id = BigInt(telegramId);
  const idHex = id.toString(16).padStart(10, '0');
  const idBytes = Buffer.from(idHex, 'hex');                              // 5 bytes
  const sig = createHmac('sha256', secret).update(telegramId).digest().slice(0, 4); // 4 bytes
  return encodeBase62(Buffer.concat([idBytes, sig]));
}

/**
 * Verify a token and return the telegramId string, or null if invalid.
 */
export function verifyAccessToken(token: string, secret: string): string | null {
  try {
    if (!token || token.length !== TOKEN_LEN) return null;
    const buf = decodeBase62(token);
    if (buf.length < TOKEN_BYTES) return null;
    const telegramId = BigInt('0x' + buf.slice(0, 5).toString('hex')).toString();
    const expectedSig = createHmac('sha256', secret).update(telegramId).digest().slice(0, 4);
    if (!timingSafeEqual(buf.slice(5, 9), expectedSig)) return null;
    return telegramId;
  } catch {
    return null;
  }
}
