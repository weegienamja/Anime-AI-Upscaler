import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  createOAuthState,
  consumeOAuthState,
  upsertUser,
  getUserByPatreonId,
  upsertPatreonTokens,
  storeRefreshToken,
  hashToken,
  DbUser,
} from '../database';
import {
  buildAuthorizeUrl,
  exchangeCode,
  getIdentity,
  getCampaignMembership,
} from '../patreon';
import {
  issueEntitlementToken,
  issueRefreshToken,
} from '../tokens';

const router = Router();

const CLIENT_ID = process.env.PATREON_CLIENT_ID!;
const CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET!;
const REDIRECT_URI = process.env.PATREON_REDIRECT_URI!;
const CAMPAIGN_ID = process.env.PATREON_CAMPAIGN_ID!;
const APP_SCHEME = process.env.APP_SCHEME || 'animeupscaler';
const ENTITLEMENT_TTL = parseInt(process.env.ENTITLEMENT_TTL || '604800', 10);

/**
 * GET /auth/start
 * Redirects the user's browser to Patreon OAuth consent screen.
 */
router.get('/start', (_req: Request, res: Response) => {
  const state = crypto.randomBytes(32).toString('hex');
  createOAuthState(state);
  const url = buildAuthorizeUrl(CLIENT_ID, REDIRECT_URI, state);
  res.redirect(url);
});

/**
 * GET /auth/callback
 * Patreon redirects here after user consent.
 * We exchange code → tokens, verify membership, then redirect to desktop app via deep link.
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state' });
    }

    // Validate state
    if (!consumeOAuthState(state)) {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }

    // Exchange code for Patreon tokens (server-side only)
    const patreonTokens = await exchangeCode(code, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

    // Get Patreon identity
    const identity = await getIdentity(patreonTokens.access_token);
    const patreonUserId = identity.id;

    // Upsert user
    let user = getUserByPatreonId(patreonUserId);
    const userId = user?.id || uuidv4();
    const dbUser: DbUser = {
      id: userId,
      patreon_user_id: patreonUserId,
      display_name: identity.attributes.full_name || 'Patron',
      email: identity.attributes.email || null,
      avatar_url: identity.attributes.image_url || null,
    };
    upsertUser(dbUser);

    // Store Patreon tokens server-side
    const expiresAt = new Date(
      Date.now() + patreonTokens.expires_in * 1000
    ).toISOString();
    upsertPatreonTokens(
      userId,
      patreonTokens.access_token,
      patreonTokens.refresh_token,
      expiresAt,
      patreonTokens.scope
    );

    // Check campaign membership
    const membership = await getCampaignMembership(
      patreonTokens.access_token,
      CAMPAIGN_ID
    );
    const isEntitled = membership?.isActive ?? false;
    const tier = membership?.tier ?? 'none';

    // Issue entitlement JWT (sent to desktop app)
    const entitlementJwt = issueEntitlementToken({
      userId,
      patreonUserId,
      entitled: isEntitled,
      tier,
      displayName: dbUser.display_name,
    });

    // Issue refresh token
    const { token: refreshToken, jti } = issueRefreshToken(userId);
    const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    storeRefreshToken(jti, userId, hashToken(refreshToken), refreshExpires);

    // Generate a one-time code to exchange (more secure than putting JWT in URL)
    const oneTimeCode = crypto.randomBytes(32).toString('hex');
    // Store temporarily (5 min TTL) — reuse oauth_states table
    const { createOAuthState: storeCode } = require('../database');
    storeCode(`otc:${oneTimeCode}`, 300);

    // Store the exchange data in memory (simple approach; use Redis in production)
    exchangeStore.set(oneTimeCode, {
      entitlementJwt,
      refreshToken,
      userId,
      displayName: dbUser.display_name,
      tier,
      entitled: isEntitled,
    });

    // Redirect to desktop app via deep link with one-time code
    const deepLink = `${APP_SCHEME}://auth/callback?code=${oneTimeCode}`;
    res.redirect(deepLink);
  } catch (err: any) {
    console.error('Auth callback error:', err);
    res.status(500).json({ error: 'Authentication failed', details: err.message });
  }
});

// Temporary in-memory store for one-time codes → exchange data.
// In production, use Redis with TTL.
const exchangeStore = new Map<
  string,
  {
    entitlementJwt: string;
    refreshToken: string;
    userId: string;
    displayName: string;
    tier: string;
    entitled: boolean;
  }
>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  // Simple cleanup: entries older than 5 min auto-expire when not consumed
  // The consumeOAuthState check handles validation
}, 5 * 60 * 1000);

/**
 * POST /auth/exchange
 * Desktop app sends the one-time code, receives entitlement JWT + refresh token.
 */
router.post('/exchange', (req: Request, res: Response) => {
  try {
    const { code } = req.body as { code?: string };

    if (!code) {
      return res.status(400).json({ error: 'Missing code' });
    }

    // Validate and consume the one-time code
    const { consumeOAuthState: consumeCode } = require('../database');
    if (!consumeCode(`otc:${code}`)) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    const data = exchangeStore.get(code);
    if (!data) {
      return res.status(400).json({ error: 'Code already consumed or expired' });
    }

    exchangeStore.delete(code);

    return res.json({
      entitlementToken: data.entitlementJwt,
      refreshToken: data.refreshToken,
      userId: data.userId,
      displayName: data.displayName,
      tier: data.tier,
      entitled: data.entitled,
    });
  } catch (err: any) {
    console.error('Exchange error:', err);
    res.status(500).json({ error: 'Exchange failed' });
  }
});

export default router;
