/**
 * Secure token storage using OS keychain via Electron safeStorage.
 * Stores entitlement JWT + refresh token encrypted on disk.
 * Falls back to plaintext only if safeStorage is unavailable.
 *
 * NEVER log token values.
 */
import { safeStorage } from 'electron';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

const STORE_DIR = path.join(app.getPath('userData'), 'auth');
const ENT_FILE = path.join(STORE_DIR, 'entitlement.enc');
const REFRESH_FILE = path.join(STORE_DIR, 'refresh.enc');
const META_FILE = path.join(STORE_DIR, 'meta.json');

function ensureDir(): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function writeEncrypted(filePath: string, plaintext: string): void {
  ensureDir();
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(plaintext);
    fs.writeFileSync(filePath, encrypted);
  } else {
    // Fallback: base64 — not truly secure, but functional
    fs.writeFileSync(filePath, Buffer.from(plaintext).toString('base64'), 'utf-8');
  }
}

function readEncrypted(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = fs.readFileSync(filePath);
      return safeStorage.decryptString(encrypted);
    } else {
      const b64 = fs.readFileSync(filePath, 'utf-8');
      return Buffer.from(b64, 'base64').toString('utf-8');
    }
  } catch {
    return null;
  }
}

function deleteFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* ignore */ }
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface StoredAuthMeta {
  userId: string;
  displayName: string;
  tier: string;
  entitled: boolean;
  lastVerifiedAt: string;     // ISO date
  lastRefreshedAt: string;    // ISO date
}

export function storeEntitlementToken(token: string): void {
  writeEncrypted(ENT_FILE, token);
}

export function getEntitlementToken(): string | null {
  return readEncrypted(ENT_FILE);
}

export function storeRefreshToken(token: string): void {
  writeEncrypted(REFRESH_FILE, token);
}

export function getRefreshToken(): string | null {
  return readEncrypted(REFRESH_FILE);
}

export function storeAuthMeta(meta: StoredAuthMeta): void {
  ensureDir();
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}

export function getAuthMeta(): StoredAuthMeta | null {
  if (!fs.existsSync(META_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function clearAllAuthData(): void {
  deleteFile(ENT_FILE);
  deleteFile(REFRESH_FILE);
  deleteFile(META_FILE);
}
