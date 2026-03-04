/**
 * Patreon API v2 helper.
 * All Patreon communication happens exclusively on this server — never in the desktop app.
 */

const PATREON_AUTH_URL = 'https://www.patreon.com/oauth2/authorize';
const PATREON_TOKEN_URL = 'https://www.patreon.com/api/oauth2/token';
const PATREON_API_BASE = 'https://www.patreon.com/api/oauth2/v2';

export interface PatreonTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export interface PatreonIdentity {
  id: string;
  attributes: {
    full_name: string;
    email: string;
    image_url: string;
  };
}

export interface PatreonMember {
  id: string;
  attributes: {
    patron_status: string | null; // 'active_patron', 'declined_patron', 'former_patron', null
    currently_entitled_amount_cents: number;
    pledge_relationship_start: string | null;
  };
  relationships?: {
    currently_entitled_tiers?: {
      data: Array<{ id: string; type: string }>;
    };
  };
}

/**
 * Build Patreon OAuth authorize URL.
 */
export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'identity identity[email] identity.memberships',
    state,
  });
  return `${PATREON_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<PatreonTokenResponse> {
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const res = await fetch(PATREON_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Patreon token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<PatreonTokenResponse>;
}

/**
 * Refresh Patreon access token.
 */
export async function refreshPatreonToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<PatreonTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(PATREON_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Patreon token refresh failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<PatreonTokenResponse>;
}

/**
 * Get user identity from Patreon.
 */
export async function getIdentity(accessToken: string): Promise<PatreonIdentity> {
  const url = `${PATREON_API_BASE}/identity?fields[user]=full_name,email,image_url`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Patreon identity fetch failed (${res.status})`);
  }

  const json = (await res.json()) as any;
  return json.data as PatreonIdentity;
}

/**
 * Check if the user is an active member of the given campaign.
 * Returns the membership info or null if not a member.
 */
export async function getCampaignMembership(
  accessToken: string,
  campaignId: string
): Promise<{ isActive: boolean; tier: string; amountCents: number } | null> {
  // Fetch memberships via identity endpoint with includes
  const url =
    `${PATREON_API_BASE}/identity` +
    `?include=memberships,memberships.currently_entitled_tiers` +
    `&fields[member]=patron_status,currently_entitled_amount_cents,pledge_relationship_start` +
    `&fields[tier]=title,amount_cents`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Patreon membership fetch failed (${res.status})`);
  }

  const json = (await res.json()) as any;
  const included: any[] = json.included || [];

  // Find the membership for our campaign
  const members = included.filter((item: any) => item.type === 'member');
  const tiers = included.filter((item: any) => item.type === 'tier');

  for (const member of members) {
    const attrs = member.attributes as PatreonMember['attributes'];
    const isActive = attrs.patron_status === 'active_patron';

    // Resolve tier name
    const entitledTierData =
      member.relationships?.currently_entitled_tiers?.data || [];
    let tierName = 'supporter';
    if (entitledTierData.length > 0) {
      const tierId = entitledTierData[0].id;
      const tierObj = tiers.find((t: any) => t.id === tierId);
      if (tierObj) {
        tierName = tierObj.attributes.title || 'supporter';
      }
    }

    return {
      isActive,
      tier: tierName,
      amountCents: attrs.currently_entitled_amount_cents || 0,
    };
  }

  return null;
}
