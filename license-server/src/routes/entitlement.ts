import { Router, Request, Response } from 'express';
import {
  getUserById,
  getPatreonTokens,
  upsertPatreonTokens,
  getLatestEntitlement,
  upsertEntitlement,
  findRefreshToken,
  revokeRefreshToken,
  storeRefreshToken,
  hashToken,
} from '../database';
import { getCampaignMembership, refreshPatreonToken } from '../patreon';
import {
  issueEntitlementToken,
  verifyRefreshToken,
  issueRefreshToken,
  verifyEntitlementToken,
} from '../tokens';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const CLIENT_ID = process.env.PATREON_CLIENT_ID!;
const CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET!;
const CAMPAIGN_ID = process.env.PATREON_CAMPAIGN_ID!;
const ENTITLEMENT_TTL = parseInt(process.env.ENTITLEMENT_TTL || '604800', 10);

/**
 * POST /entitlement/refresh
 * Desktop app sends its refresh token → gets a new entitlement JWT.
 * Server re-verifies Patreon membership status.
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken: clientRefreshToken } = req.body as { refreshToken?: string };

    if (!clientRefreshToken) {
      return res.status(400).json({ error: 'Missing refresh token' });
    }

    // Verify refresh JWT
    let payload;
    try {
      payload = verifyRefreshToken(clientRefreshToken);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Check in database
    const storedToken = findRefreshToken(hashToken(clientRefreshToken));
    if (!storedToken) {
      return res.status(401).json({ error: 'Refresh token revoked or not found' });
    }

    // Get user
    const user = getUserById(payload.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get Patreon tokens
    let patreonTokens = getPatreonTokens(user.id);
    if (!patreonTokens) {
      return res.status(400).json({ error: 'No Patreon connection found' });
    }

    // Refresh Patreon token if expired
    const now = new Date();
    if (new Date(patreonTokens.expires_at) <= now) {
      try {
        const refreshed = await refreshPatreonToken(
          patreonTokens.refresh_token,
          CLIENT_ID,
          CLIENT_SECRET
        );
        const newExpires = new Date(
          Date.now() + refreshed.expires_in * 1000
        ).toISOString();
        upsertPatreonTokens(
          user.id,
          refreshed.access_token,
          refreshed.refresh_token,
          newExpires,
          refreshed.scope
        );
        patreonTokens = {
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          expires_at: newExpires,
        };
      } catch (err: any) {
        console.error('Patreon token refresh failed:', err.message);
        // If Patreon refresh fails, issue entitlement based on last known status
        const lastEnt = getLatestEntitlement(user.id);
        if (lastEnt && lastEnt.entitled) {
          const entitlementJwt = issueEntitlementToken({
            userId: user.id,
            patreonUserId: user.patreon_user_id,
            entitled: true,
            tier: lastEnt.tier,
            displayName: user.display_name,
          });
          return res.json({
            entitlementToken: entitlementJwt,
            entitled: true,
            tier: lastEnt.tier,
            cached: true,
          });
        }
        return res.status(502).json({ error: 'Unable to verify Patreon status' });
      }
    }

    // Verify membership
    const membership = await getCampaignMembership(
      patreonTokens.access_token,
      CAMPAIGN_ID
    );
    const isEntitled = membership?.isActive ?? false;
    const tier = membership?.tier ?? 'none';

    // Issue new entitlement JWT
    const entitlementJwt = issueEntitlementToken({
      userId: user.id,
      patreonUserId: user.patreon_user_id,
      entitled: isEntitled,
      tier,
      displayName: user.display_name,
    });

    // Store entitlement record
    const entId = uuidv4();
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ENTITLEMENT_TTL * 1000).toISOString();
    upsertEntitlement({
      id: entId,
      user_id: user.id,
      patreon_user_id: user.patreon_user_id,
      entitled: isEntitled ? 1 : 0,
      tier,
      issued_at: issuedAt,
      expires_at: expiresAt,
      last_verified_at: issuedAt,
    });

    // Rotate refresh token
    revokeRefreshToken(storedToken.id);
    const { token: newRefreshToken, jti: newJti } = issueRefreshToken(user.id);
    const refreshExpires = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    storeRefreshToken(newJti, user.id, hashToken(newRefreshToken), refreshExpires);

    return res.json({
      entitlementToken: entitlementJwt,
      refreshToken: newRefreshToken,
      entitled: isEntitled,
      tier,
      displayName: user.display_name,
    });
  } catch (err: any) {
    console.error('Entitlement refresh error:', err);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

/**
 * GET /entitlement/status
 * Desktop app sends entitlement JWT in Authorization header.
 * Returns decoded status without re-verifying with Patreon.
 */
router.get('/status', (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.slice(7);
    const payload = verifyEntitlementToken(token);

    return res.json({
      userId: payload.userId,
      patreonUserId: payload.patreonUserId,
      entitled: payload.entitled,
      tier: payload.tier,
      displayName: payload.displayName,
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
  } catch (err: any) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
