import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'dev-refresh-secret';
const ENTITLEMENT_TTL = parseInt(process.env.ENTITLEMENT_TTL || '604800', 10); // 7 days

export interface EntitlementPayload {
  userId: string;
  patreonUserId: string;
  entitled: boolean;
  tier: string;
  displayName: string;
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  jti: string;       // unique id for revocation
  userId: string;
  type: 'refresh';
}

/**
 * Issue a signed entitlement JWT.
 */
export function issueEntitlementToken(params: {
  userId: string;
  patreonUserId: string;
  entitled: boolean;
  tier: string;
  displayName: string;
}): string {
  return jwt.sign(
    {
      userId: params.userId,
      patreonUserId: params.patreonUserId,
      entitled: params.entitled,
      tier: params.tier,
      displayName: params.displayName,
    },
    JWT_SECRET,
    { expiresIn: ENTITLEMENT_TTL }
  );
}

/**
 * Verify and decode an entitlement JWT.
 */
export function verifyEntitlementToken(token: string): EntitlementPayload {
  return jwt.verify(token, JWT_SECRET) as EntitlementPayload;
}

/**
 * Issue a refresh token (opaque + JWT combo).
 */
export function issueRefreshToken(userId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { jti, userId, type: 'refresh' } satisfies RefreshTokenPayload,
    REFRESH_TOKEN_SECRET,
    { expiresIn: '30d' }
  );
  return { token, jti };
}

/**
 * Verify a refresh JWT and return its payload.
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, REFRESH_TOKEN_SECRET) as RefreshTokenPayload;
  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return payload;
}
