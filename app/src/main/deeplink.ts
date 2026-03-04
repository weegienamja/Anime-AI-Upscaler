/**
 * Deep link handler for custom protocol "animeupscaler://".
 * Handles:
 *   animeupscaler://auth/callback?code=ONE_TIME_CODE
 *
 * Windows/Linux: received via second-instance event argv
 * macOS: received via open-url event
 */
import { app, BrowserWindow } from 'electron';
import { IPC } from '../shared/types';

const PROTOCOL = 'animeupscaler';

/**
 * Register the custom protocol as the default handler.
 * Must be called before app.whenReady() for production builds.
 */
export function registerDeepLinkProtocol(): void {
  if (process.defaultApp) {
    // Dev mode: register with path to electron + script
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

import path from 'path';

/**
 * Parse a deep link URL and return the one-time code if it's an auth callback.
 */
export function parseDeepLink(url: string): { code: string } | null {
  try {
    // animeupscaler://auth/callback?code=xxx
    const parsed = new URL(url);
    if (parsed.protocol !== `${PROTOCOL}:`) return null;
    if (parsed.hostname !== 'auth' || parsed.pathname !== '/callback') return null;
    const code = parsed.searchParams.get('code');
    if (!code) return null;
    return { code };
  } catch {
    return null;
  }
}

/**
 * Set up deep link listeners.
 * Call this once after creating the main window.
 */
export function setupDeepLinkHandlers(getMainWindow: () => BrowserWindow | null): void {
  // macOS: open-url event
  app.on('open-url', (_event, url) => {
    const result = parseDeepLink(url);
    if (result) {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.AUTH_HANDLE_CALLBACK, result.code);
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    }
  });

  // Windows / Linux: second-instance event (already exists, extend it)
  // This is handled in index.ts by extending the existing second-instance handler.
}

/**
 * Extract deep link from process argv (Windows/Linux).
 * Used on startup and in second-instance handler.
 */
export function extractDeepLinkFromArgv(argv: string[]): string | null {
  // The deep link URL is typically the last argument
  for (const arg of argv) {
    if (arg.startsWith(`${PROTOCOL}://`)) {
      return arg;
    }
  }
  return null;
}
