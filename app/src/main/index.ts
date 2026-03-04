import { app, BrowserWindow, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { database } from './database';
import { engineManager } from './engineManager';
import {
  Waifu2xEngine,
  RealESRGANEngine,
  RealCUGANEngine,
  Anime4KEngine,
  SwinIREngine,
  HATEngine,
} from './engines';
import { ffmpegPipeline } from './ffmpegPipeline';
import { registerIpcHandlers } from './ipcHandlers';
import {
  registerDeepLinkProtocol,
  setupDeepLinkHandlers,
  extractDeepLinkFromArgv,
  parseDeepLink,
} from './deeplink';
import { IPC } from '../shared/types';
import { engineInstaller } from './engineInstaller';

let mainWindow: BrowserWindow | null = null;

// Register custom protocol early (before ready) for packaged builds
registerDeepLinkProtocol();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Anime Upscaler',
    backgroundColor: '#1a1b2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
  });

  // Load renderer
  const isDev = !app.isPackaged;
  const rendererHtml = path.join(__dirname, '..', '..', 'renderer', 'index.html');

  // Capture reference so it survives even if mainWindow is nulled
  const win = mainWindow;

  if (isDev) {
    win.loadURL('http://localhost:9000').catch(() => {
      if (!win.isDestroyed()) {
        win.loadFile(rendererHtml).catch((err: any) => {
          console.error('Failed to load renderer:', err?.message);
        });
      }
    });
  } else {
    win.loadFile(rendererHtml).catch((err: any) => {
      console.error('Failed to load renderer:', err?.message);
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Register IPC handlers
  registerIpcHandlers(mainWindow);
}

/**
 * Search bin/ subdirectories for an executable (handles release zips like
 * bin/waifu2x-ncnn-vulkan-20250915-windows/waifu2x-ncnn-vulkan.exe)
 */
function findExeInBinSubdirs(workspaceDir: string, exeName: string): string[] {
  const binDir = path.join(workspaceDir, 'bin');
  const results: string[] = [];
  try {
    if (fs.existsSync(binDir) && fs.statSync(binDir).isDirectory()) {
      for (const entry of fs.readdirSync(binDir)) {
        const subDir = path.join(binDir, entry);
        if (fs.statSync(subDir).isDirectory()) {
          results.push(path.join(subDir, `${exeName}.exe`));
          results.push(path.join(subDir, exeName));
        }
      }
    }
  } catch {
    // skip
  }
  return results;
}

/**
 * Try to find an engine executable by searching common locations.
 * Returns the first path that exists, or the fallback name.
 */
function resolveEnginePath(configured: string, exeName: string, fallback: string): string {
  // If user explicitly configured a path, use it
  if (configured && configured.trim() !== '') {
    return configured;
  }

  // Search common locations relative to the app
  const appDir = app.getAppPath();               // .../app
  const workspaceDir = path.dirname(appDir);      // .../waifu2x-ncnn-vulkan
  const parentDir = path.dirname(workspaceDir);   // .../Anime upscaler

  const candidates = [
    // Same directory as app
    path.join(appDir, exeName),
    path.join(appDir, `${exeName}.exe`),
    // Workspace root (e.g. waifu2x-ncnn-vulkan/)
    path.join(workspaceDir, `${exeName}.exe`),
    // bin/ directory (downloaded releases)
    path.join(workspaceDir, 'bin', `${exeName}.exe`),
    // bin/ subdirectories (release zips extract into named folders)
    ...findExeInBinSubdirs(workspaceDir, exeName),
    // Build output directory
    path.join(workspaceDir, 'build', `${exeName}.exe`),
    path.join(workspaceDir, 'build', 'Release', `${exeName}.exe`),
    path.join(workspaceDir, 'build', 'Debug', `${exeName}.exe`),
    // Parent directory (Anime upscaler/)
    path.join(parentDir, `${exeName}.exe`),
    path.join(parentDir, exeName, `${exeName}.exe`),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        console.log(`[Engine] Found ${exeName} at: ${p}`);
        return p;
      }
    } catch {
      // skip
    }
  }

  // Fall back to bare name (will rely on PATH)
  return fallback;
}

function initEngines(): void {
  // Load saved settings to get engine paths
  const settings = database.getAppSettings();

  const w2x = resolveEnginePath(settings.enginePaths.waifu2x, 'waifu2x-ncnn-vulkan', 'waifu2x-ncnn-vulkan');
  const realesrgan = resolveEnginePath(settings.enginePaths.realesrgan, 'realesrgan-ncnn-vulkan', 'realesrgan-ncnn-vulkan');
  const realcugan = resolveEnginePath(settings.enginePaths.realcugan, 'realcugan-ncnn-vulkan', 'realcugan-ncnn-vulkan');
  const anime4k = resolveEnginePath(settings.enginePaths.anime4k, 'ac_cli', 'ac_cli');
  const swinir = settings.enginePaths.swinir || 'python';
  const hat = settings.enginePaths.hat || 'python';

  engineManager.register(new Waifu2xEngine(w2x));
  engineManager.register(new RealESRGANEngine(realesrgan));
  engineManager.register(new RealCUGANEngine(realcugan));
  engineManager.register(new Anime4KEngine(anime4k));
  engineManager.register(new SwinIREngine(swinir));
  engineManager.register(new HATEngine(hat));

  // Set ffmpeg path
  ffmpegPipeline.setPath(settings.ffmpegPath || 'ffmpeg');
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Allow loading local file:// images for preview
  protocol.registerFileProtocol('file', (request, callback) => {
    const filePath = decodeURIComponent(
      request.url.replace('file:///', '').replace('file://', '')
    );
    callback(filePath);
  });

  // Initialize SQLite database
  database.init();

  // Initialize engine installer
  engineInstaller.init();

  // Register engines
  initEngines();

  createWindow();

  // Set up macOS deep link handler
  setupDeepLinkHandlers(() => mainWindow);

  // Check if launched via deep link (Windows/Linux)
  const deepLinkUrl = extractDeepLinkFromArgv(process.argv);
  if (deepLinkUrl) {
    const result = parseDeepLink(deepLinkUrl);
    if (result && mainWindow) {
      // Small delay to ensure renderer is ready
      setTimeout(() => {
        mainWindow?.webContents.send(IPC.AUTH_HANDLE_CALLBACK, result.code);
      }, 2000);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      // Check for deep link in argv (Windows/Linux)
      const deepLinkUrl = extractDeepLinkFromArgv(argv);
      if (deepLinkUrl) {
        const result = parseDeepLink(deepLinkUrl);
        if (result) {
          mainWindow.webContents.send(IPC.AUTH_HANDLE_CALLBACK, result.code);
        }
      }
    }
  });
}
