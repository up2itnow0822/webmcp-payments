/**
 * Simple HMAC-based access tokens for session management
 * No external deps — uses Node.js built-in crypto
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 3600; // 1 hour

interface AccessTokenPayload {
  nonce: string;
  txHash: string;
  payer: string;
  resource: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Issue a signed access token after payment verification
 */
export function issueAccessToken(
  nonce: string,
  txHash: string,
  payer: string,
  resource: string,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): { token: string; expiresAt: number } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;

  const payload: AccessTokenPayload = {
    nonce,
    txHash,
    payer,
    resource,
    issuedAt,
    expiresAt,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const token = `${payloadB64}.${sig}`;

  return { token, expiresAt };
}

/**
 * Verify and decode an access token
 */
export function verifyAccessToken(
  token: string,
  secret: string
): { valid: boolean; payload?: AccessTokenPayload; error?: string } {
  try {
    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) {
      return { valid: false, error: 'Malformed token' };
    }

    const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, error: 'Invalid signature' };
    }

    const payload: AccessTokenPayload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as AccessTokenPayload;

    const now = Math.floor(Date.now() / 1000);
    if (now > payload.expiresAt) {
      return { valid: false, error: 'Token expired' };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: 'Token parse error' };
  }
}

/**
 * Generate a secret key for signing tokens
 */
export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}
