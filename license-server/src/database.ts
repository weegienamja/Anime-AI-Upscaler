import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

const DB_PATH = path.join(__dirname, '..', 'data', 'license.db');

let db: Database.Database;

export function initDatabase(): void {
  const fs = require('fs');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      patreon_user_id TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patreon_tokens (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      scope TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entitlements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      patreon_user_id TEXT NOT NULL,
      entitled INTEGER NOT NULL DEFAULT 0,
      tier TEXT NOT NULL DEFAULT 'free',
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_verified_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
  `);
}

export function getDb(): Database.Database {
  return db;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── OAuth State ──────────────────────────────────────────────────────────

export function createOAuthState(state: string, ttlSeconds: number = 600): void {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  getDb()
    .prepare('INSERT OR REPLACE INTO oauth_states (state, expires_at) VALUES (?, ?)')
    .run(state, expiresAt);
}

export function consumeOAuthState(state: string): boolean {
  const row = getDb()
    .prepare('SELECT state FROM oauth_states WHERE state = ? AND expires_at > datetime("now")')
    .get(state) as any;
  if (!row) return false;
  getDb().prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
  return true;
}

// ─── Users ────────────────────────────────────────────────────────────────

export interface DbUser {
  id: string;
  patreon_user_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
}

export function upsertUser(user: DbUser): void {
  getDb()
    .prepare(
      `INSERT INTO users (id, patreon_user_id, display_name, email, avatar_url, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(patreon_user_id) DO UPDATE SET
         display_name = excluded.display_name,
         email = excluded.email,
         avatar_url = excluded.avatar_url,
         updated_at = datetime('now')`
    )
    .run(user.id, user.patreon_user_id, user.display_name, user.email, user.avatar_url);
}

export function getUserByPatreonId(patreonUserId: string): DbUser | undefined {
  return getDb()
    .prepare('SELECT * FROM users WHERE patreon_user_id = ?')
    .get(patreonUserId) as DbUser | undefined;
}

export function getUserById(userId: string): DbUser | undefined {
  return getDb()
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(userId) as DbUser | undefined;
}

// ─── Patreon Tokens ───────────────────────────────────────────────────────

export function upsertPatreonTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: string,
  scope?: string
): void {
  getDb()
    .prepare(
      `INSERT INTO patreon_tokens (user_id, access_token, refresh_token, expires_at, scope, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         updated_at = datetime('now')`
    )
    .run(userId, accessToken, refreshToken, expiresAt, scope || null);
}

export function getPatreonTokens(userId: string): {
  access_token: string;
  refresh_token: string;
  expires_at: string;
} | undefined {
  return getDb()
    .prepare('SELECT access_token, refresh_token, expires_at FROM patreon_tokens WHERE user_id = ?')
    .get(userId) as any;
}

// ─── Entitlements ─────────────────────────────────────────────────────────

export interface DbEntitlement {
  id: string;
  user_id: string;
  patreon_user_id: string;
  entitled: number;
  tier: string;
  issued_at: string;
  expires_at: string;
  last_verified_at: string;
}

export function upsertEntitlement(ent: DbEntitlement): void {
  getDb()
    .prepare(
      `INSERT INTO entitlements (id, user_id, patreon_user_id, entitled, tier, issued_at, expires_at, last_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         entitled = excluded.entitled,
         tier = excluded.tier,
         issued_at = excluded.issued_at,
         expires_at = excluded.expires_at,
         last_verified_at = excluded.last_verified_at`
    )
    .run(ent.id, ent.user_id, ent.patreon_user_id, ent.entitled, ent.tier, ent.issued_at, ent.expires_at, ent.last_verified_at);
}

export function getLatestEntitlement(userId: string): DbEntitlement | undefined {
  return getDb()
    .prepare('SELECT * FROM entitlements WHERE user_id = ? ORDER BY issued_at DESC LIMIT 1')
    .get(userId) as DbEntitlement | undefined;
}

// ─── Refresh Tokens ───────────────────────────────────────────────────────

export function storeRefreshToken(
  id: string,
  userId: string,
  tokenHash: string,
  expiresAt: string
): void {
  getDb()
    .prepare(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
    )
    .run(id, userId, tokenHash, expiresAt);
}

export function findRefreshToken(tokenHash: string): {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked: number;
} | undefined {
  return getDb()
    .prepare(
      'SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0 AND expires_at > datetime("now")'
    )
    .get(tokenHash) as any;
}

export function revokeRefreshToken(id: string): void {
  getDb().prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(id);
}

export function revokeAllUserRefreshTokens(userId: string): void {
  getDb().prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────

export function cleanupExpired(): void {
  getDb().prepare('DELETE FROM oauth_states WHERE expires_at < datetime("now")').run();
  getDb().prepare('DELETE FROM refresh_tokens WHERE expires_at < datetime("now") OR revoked = 1').run();
}

// ─── All users with Patreon tokens (for cron refresh) ─────────────────────

export function getAllUsersWithPatreonTokens(): Array<{
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}> {
  return getDb()
    .prepare('SELECT user_id, access_token, refresh_token, expires_at FROM patreon_tokens')
    .all() as any[];
}
