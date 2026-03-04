/**
 * License client — desktop-side module for communicating with the license server.
 * Handles:
 *   - Exchanging one-time code for entitlement + refresh tokens
 *   - Refreshing entitlement
 *   - Checking entitlement status locally
 *   - Offline grace period (72h)
 */
import {
  EntitlementStatus,
  AuthExchangeResponse,
} from '../shared/types';
import {
  storeEntitlementToken,
  getEntitlementToken,
  storeRefreshToken,
  getRefreshToken,
  storeAuthMeta,
  getAuthMeta,
  clearAllAuthData,
  StoredAuthMeta,
} from './tokenStore';
import { database } from './database';

const OFFLINE_GRACE_HOURS = 72;

function getServerUrl(): string {
  try {
    const settings = database.getAppSettings();
    return settings.licenseServerUrl || 'https://YOUR_DOMAIN';
  } catch {
    return 'https://YOUR_DOMAIN';
  }
}

/**
 * Exchange a one-time code (from deep link callback) for tokens.
 */
export async function exchangeAuthCode(code: string): Promise<EntitlementStatus> {
  const serverUrl = getServerUrl();
  const res = await fetch(`${serverUrl}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `Exchange failed (${res.status})`);
  }

  const data = (await res.json()) as AuthExchangeResponse;

  // Store tokens securely
  storeEntitlementToken(data.entitlementToken);
  storeRefreshToken(data.refreshToken);

  const now = new Date().toISOString();
  const meta: StoredAuthMeta = {
    userId: data.userId,
    displayName: data.displayName,
    tier: data.tier,
    entitled: data.entitled,
    lastVerifiedAt: now,
    lastRefreshedAt: now,
  };
  storeAuthMeta(meta);

  return buildStatus(meta, data.entitlementToken);
}

/**
 * Refresh entitlement by calling the license server.
 */
export async function refreshEntitlement(): Promise<EntitlementStatus> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return {
      loggedIn: false,
      entitled: false,
      error: 'Not logged in',
    };
  }

  const serverUrl = getServerUrl();
  const res = await fetch(`${serverUrl}/entitlement/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // If refresh fails, check offline grace
    const meta = getAuthMeta();
    if (meta) {
      const status = buildLocalStatus(meta);
      status.error = (body as any).error || `Refresh failed (${res.status})`;
      return status;
    }
    throw new Error((body as any).error || `Refresh failed (${res.status})`);
  }

  const data = (await res.json()) as {
    entitlementToken: string;
    refreshToken?: string;
    entitled: boolean;
    tier: string;
    displayName: string;
  };

  // Update stored tokens
  storeEntitlementToken(data.entitlementToken);
  if (data.refreshToken) {
    storeRefreshToken(data.refreshToken);
  }

  const now = new Date().toISOString();
  const meta: StoredAuthMeta = {
    userId: getAuthMeta()?.userId || '',
    displayName: data.displayName,
    tier: data.tier,
    entitled: data.entitled,
    lastVerifiedAt: now,
    lastRefreshedAt: now,
  };
  storeAuthMeta(meta);

  return buildStatus(meta, data.entitlementToken);
}

/**
 * Get the current entitlement status (local check only, no network).
 */
export function getEntitlementStatus(): EntitlementStatus {
  const meta = getAuthMeta();
  if (!meta) {
    return { loggedIn: false, entitled: false };
  }
  return buildLocalStatus(meta);
}

/**
 * Check whether processing should be allowed.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function validateEntitlementForProcessing(): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  // If no license server is configured, skip entitlement check entirely
  const serverUrl = getServerUrl();
  if (!serverUrl || serverUrl === 'https://YOUR_DOMAIN' || serverUrl.trim() === '') {
    return { allowed: true };
  }

  const meta = getAuthMeta();
  if (!meta) {
    return { allowed: false, reason: 'Not logged in. Please log in via Settings → Account.' };
  }

  if (!meta.entitled) {
    return {
      allowed: false,
      reason: 'Your Patreon subscription is not active. Please renew to continue processing.',
    };
  }

  const token = getEntitlementToken();
  if (!token) {
    return { allowed: false, reason: 'Entitlement token missing. Please log in again.' };
  }

  // Check if token is expiring within 24h
  try {
    const payload = parseJwtPayload(token);
    const expiresAt = payload.exp * 1000;
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (expiresAt < now) {
      // Token expired — try refresh
      try {
        const status = await refreshEntitlement();
        if (!status.entitled) {
          return { allowed: false, reason: 'Subscription is no longer active.' };
        }
        return { allowed: true };
      } catch {
        // Check offline grace
        return checkOfflineGrace(meta);
      }
    }

    if (expiresAt - now < twentyFourHours) {
      // Expiring soon — try refresh silently
      try {
        await refreshEntitlement();
      } catch {
        // Still valid, proceed
      }
    }

    return { allowed: true };
  } catch {
    // Can't parse token — check offline grace
    return checkOfflineGrace(meta);
  }
}

/**
 * Log out — clear all stored auth data.
 */
export function logout(): void {
  clearAllAuthData();
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseJwtPayload(token: string): { exp: number; iat: number; [key: string]: any } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}

function buildStatus(meta: StoredAuthMeta, token: string): EntitlementStatus {
  try {
    const payload = parseJwtPayload(token);
    const graceDeadline = new Date(
      new Date(meta.lastVerifiedAt).getTime() + OFFLINE_GRACE_HOURS * 60 * 60 * 1000
    ).toISOString();

    return {
      loggedIn: true,
      entitled: meta.entitled,
      userId: meta.userId,
      displayName: meta.displayName,
      tier: meta.tier,
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      lastVerifiedAt: meta.lastVerifiedAt,
      offlineGraceDeadline: graceDeadline,
    };
  } catch {
    return buildLocalStatus(meta);
  }
}

function buildLocalStatus(meta: StoredAuthMeta): EntitlementStatus {
  const graceDeadline = new Date(
    new Date(meta.lastVerifiedAt).getTime() + OFFLINE_GRACE_HOURS * 60 * 60 * 1000
  ).toISOString();

  return {
    loggedIn: true,
    entitled: meta.entitled,
    userId: meta.userId,
    displayName: meta.displayName,
    tier: meta.tier,
    lastVerifiedAt: meta.lastVerifiedAt,
    offlineGraceDeadline: graceDeadline,
  };
}

function checkOfflineGrace(meta: StoredAuthMeta): { allowed: boolean; reason?: string } {
  const lastVerified = new Date(meta.lastVerifiedAt).getTime();
  const graceDeadline = lastVerified + OFFLINE_GRACE_HOURS * 60 * 60 * 1000;

  if (Date.now() < graceDeadline) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason:
      'Offline grace period (72h) exceeded. Please connect to the internet and refresh your license.',
  };
}
