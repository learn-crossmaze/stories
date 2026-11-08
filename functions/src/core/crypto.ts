import { createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison; false for empty or missing values (an unset secret never matches). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checks a webhook's HMAC-SHA256 hex signature (optionally after a prefix such as `sha256=`) in constant time. */
export function hmacHexMatches(body: Buffer | string, signature: string | null | undefined, secret: string | null | undefined, prefix = ''): boolean {
  if (!secret || !signature?.startsWith(prefix)) return false;
  return safeEqual(createHmac('sha256', secret).update(body).digest('hex'), signature.slice(prefix.length));
}
