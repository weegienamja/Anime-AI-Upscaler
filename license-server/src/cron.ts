/**
 * Cron job to periodically refresh Patreon tokens that are close to expiry.
 * Runs every 6 hours.
 */
import cron from 'node-cron';
import {
  getAllUsersWithPatreonTokens,
  upsertPatreonTokens,
  cleanupExpired,
} from './database';
import { refreshPatreonToken } from './patreon';

const CLIENT_ID = process.env.PATREON_CLIENT_ID!;
const CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET!;

/**
 * Start the periodic Patreon token refresh job.
 */
export function startCronJobs(): void {
  // Every 6 hours: refresh Patreon tokens that expire within 24 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('[Cron] Refreshing Patreon tokens...');
    await refreshExpiringPatreonTokens();
  });

  // Every hour: clean up expired states and revoked refresh tokens
  cron.schedule('0 * * * *', () => {
    console.log('[Cron] Cleaning up expired records...');
    cleanupExpired();
  });

  console.log('[Cron] Scheduled jobs started.');
}

async function refreshExpiringPatreonTokens(): Promise<void> {
  const allTokens = getAllUsersWithPatreonTokens();
  const now = Date.now();
  const threshold = 24 * 60 * 60 * 1000; // 24 hours

  for (const entry of allTokens) {
    const expiresAt = new Date(entry.expires_at).getTime();
    if (expiresAt - now < threshold) {
      try {
        const refreshed = await refreshPatreonToken(
          entry.refresh_token,
          CLIENT_ID,
          CLIENT_SECRET
        );
        const newExpires = new Date(
          Date.now() + refreshed.expires_in * 1000
        ).toISOString();
        upsertPatreonTokens(
          entry.user_id,
          refreshed.access_token,
          refreshed.refresh_token,
          newExpires,
          refreshed.scope
        );
        console.log(`[Cron] Refreshed tokens for user ${entry.user_id}`);
      } catch (err: any) {
        console.error(
          `[Cron] Failed to refresh tokens for user ${entry.user_id}:`,
          err.message
        );
      }
    }
  }
}
