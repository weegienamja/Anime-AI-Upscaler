import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  IPC,
  Job,
  JobConfig,
  Preset,
  AppSettings,
  CropRegion,
} from '../shared/types';
import { queueManager } from './queueManager';
import { jobRunner } from './jobRunner';
import { database } from './database';
import { getSystemInfo } from './systemInfo';
import { ffmpegPipeline } from './ffmpegPipeline';
import { DEFAULT_PRESETS } from '../shared/presets';
import {
  exchangeAuthCode,
  refreshEntitlement,
  getEntitlementStatus,
  validateEntitlementForProcessing,
  logout,
} from './licenseClient';
import { engineInstaller, InstallProgress } from './engineInstaller';
import { engineManager } from './engineManager';
import {
  Waifu2xEngine,
  RealESRGANEngine,
  RealCUGANEngine,
  Anime4KEngine,
  SwinIREngine,
  HATEngine,
} from './engines';

/**
 * Register all IPC handlers for main ↔ renderer communication.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // ─── Jobs ───────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.JOB_CREATE,
    async (
      _event,
      params: {
        name: string;
        inputPaths: string[];
        outputDir: string;
        mediaType: 'image' | 'video';
        config: JobConfig;
        runNow?: boolean;
      }
    ) => {
      const job: Job = {
        id: uuidv4(),
        name: params.name,
        inputPaths: params.inputPaths,
        outputDir: params.outputDir,
        mediaType: params.mediaType,
        config: params.config,
        status: 'queued',
        progress: 0,
        totalFiles: params.inputPaths.length,
        processedFiles: 0,
        createdAt: new Date().toISOString(),
        retryCount: 0,
        stdoutLog: [],
      };

      if (params.runNow) {
        // Validate entitlement before running immediately
        const check = await validateEntitlementForProcessing();
        if (!check.allowed) {
          throw new Error(check.reason || 'License validation failed');
        }
        queueManager.runNow(job);
      } else {
        queueManager.addJob(job);
      }

      return job;
    }
  );

  ipcMain.handle(IPC.JOB_CANCEL, async (_event, jobId: string) => {
    queueManager.cancelJob(jobId);
  });

  ipcMain.handle(IPC.JOB_RETRY, async (_event, jobId: string) => {
    queueManager.retryJob(jobId);
  });

  ipcMain.handle(
    IPC.JOB_MOVE,
    async (_event, jobId: string, direction: 'up' | 'down') => {
      queueManager.moveJob(jobId, direction);
    }
  );

  ipcMain.handle(IPC.JOB_LIST, async () => {
    return queueManager.getState();
  });

  // ─── Queue ──────────────────────────────────────────────────────────

  ipcMain.handle(IPC.QUEUE_PAUSE, async () => {
    queueManager.pause();
  });

  ipcMain.handle(IPC.QUEUE_RESUME, async () => {
    queueManager.resume();
  });

  ipcMain.handle(IPC.QUEUE_STOP_ALL, async () => {
    queueManager.stopAll();
  });

  ipcMain.handle(IPC.QUEUE_STATE, async () => {
    return queueManager.getState();
  });

  // ─── Preview ────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.PREVIEW_RUN,
    async (
      _event,
      params: {
        inputPath: string;
        config: JobConfig;
        cropRegion: CropRegion;
      }
    ) => {
      const tmpDir = path.join(os.tmpdir(), 'anime-upscaler-preview');
      fs.mkdirSync(tmpDir, { recursive: true });

      const ext = path.extname(params.inputPath);
      const cropPath = path.join(tmpDir, `crop_before${ext}`);
      const resultPath = path.join(tmpDir, `crop_after${ext}`);
      const beforePath = path.join(tmpDir, `preview_before${ext}`);

      // Crop the region
      await ffmpegPipeline.cropImage(
        params.inputPath,
        cropPath,
        params.cropRegion.x,
        params.cropRegion.y,
        params.cropRegion.width,
        params.cropRegion.height
      );

      // Copy before for display
      fs.copyFileSync(cropPath, beforePath);

      // Run engine on crop
      const start = Date.now();
      await jobRunner.runPreview(cropPath, resultPath, params.config);
      const elapsedMs = Date.now() - start;

      return {
        beforePath,
        afterPath: resultPath,
        elapsedMs,
      };
    }
  );

  // ─── Settings ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    return database.getAppSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SET, async (_event, settings: AppSettings) => {
    database.setAppSettings(settings);
    // Update engine paths & ffmpeg path
    ffmpegPipeline.setPath(settings.ffmpegPath);
    queueManager.setMaxConcurrent(settings.maxConcurrentJobs);
    // Update temp directory for video processing
    jobRunner.setTempDir(settings.tempDir || '');
    // Update Python / GMFSS paths for frame interpolation
    jobRunner.setPythonPath(settings.pythonPath || 'python');
    jobRunner.setGmfssPath(settings.gmfssPath || '');
  });

  // ─── Presets ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.PRESET_LIST, async () => {
    let presets = database.getPresets();
    if (presets.length === 0) {
      // Seed with defaults
      for (const p of DEFAULT_PRESETS) {
        database.savePreset(p);
      }
      presets = database.getPresets();
    }
    return presets;
  });

  ipcMain.handle(IPC.PRESET_SAVE, async (_event, preset: Preset) => {
    preset.updatedAt = new Date().toISOString();
    if (!preset.id) {
      preset.id = uuidv4();
      preset.createdAt = new Date().toISOString();
    }
    database.savePreset(preset);
    return preset;
  });

  ipcMain.handle(IPC.PRESET_DELETE, async (_event, presetId: string) => {
    database.deletePreset(presetId);
  });

  // ─── History ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.HISTORY_LIST, async () => {
    return database.getHistory();
  });

  ipcMain.handle(IPC.HISTORY_CLEAR, async () => {
    database.clearHistory();
  });

  // ─── System ─────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SYSTEM_INFO, async () => {
    return getSystemInfo();
  });

  ipcMain.handle(IPC.SYSTEM_BENCHMARK, async () => {
    // Placeholder for benchmark: could run a small test upscale
    return { message: 'Benchmark not yet implemented' };
  });

  // ─── Dialogs ────────────────────────────────────────────────────────

  ipcMain.handle(IPC.DIALOG_SELECT_FILES, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images & Videos',
          extensions: [
            'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff',
            'mp4', 'mkv', 'avi', 'webm', 'mov',
          ],
        },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(IPC.DIALOG_SELECT_DIR, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(IPC.OPEN_FOLDER, async (_event, folderPath: string) => {
    shell.openPath(folderPath);
  });

  // ─── Forward queue events to renderer ───────────────────────────────

  const send = (channel: string, ...args: any[]) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  };

  queueManager.on('jobProgress', (job: Job) => {
    send(IPC.JOB_PROGRESS, { jobId: job.id, progress: job.progress });
  });

  queueManager.on('jobStatus', (job: Job) => {
    send(IPC.JOB_STATUS, job);
  });

  queueManager.on('jobLog', (jobId: string, line: string) => {
    send(IPC.JOB_LOG, { jobId, line });
  });

  queueManager.on('queueChanged', (state: any) => {
    send(IPC.QUEUE_STATE, state);
  });

  queueManager.on('jobCompleted', (job: Job) => {
    send(IPC.JOB_STATUS, job);
  });

  queueManager.on('jobFailed', (job: Job) => {
    send(IPC.JOB_STATUS, job);
  });

  // ─── Engine Install ────────────────────────────────────────────────

  ipcMain.handle(IPC.ENGINE_STATUS, async () => {
    return engineInstaller.getEngineStatuses();
  });

  ipcMain.handle(IPC.ENGINE_INSTALL, async (_event, engineId: string) => {
    const installPath = await engineInstaller.install(engineId as any);

    // Re-register the engine with the new path
    const engineMap: Record<string, () => void> = {
      waifu2x: () => engineManager.register(new Waifu2xEngine(installPath)),
      realesrgan: () => engineManager.register(new RealESRGANEngine(installPath)),
      realcugan: () => engineManager.register(new RealCUGANEngine(installPath)),
      anime4k: () => engineManager.register(new Anime4KEngine(installPath)),
      swinir: () => engineManager.register(new SwinIREngine(installPath)),
      hat: () => engineManager.register(new HATEngine(installPath)),
    };
    engineMap[engineId]?.();

    return engineInstaller.getEngineStatuses();
  });

  engineInstaller.on('progress', (progress: InstallProgress) => {
    send(IPC.ENGINE_INSTALL_PROGRESS, progress);
  });

  // ─── Auth / Licensing ──────────────────────────────────────────────

  ipcMain.handle(IPC.AUTH_START_LOGIN, async () => {
    const settings = database.getAppSettings();
    const serverUrl = settings.licenseServerUrl || 'https://YOUR_DOMAIN';
    shell.openExternal(`${serverUrl}/auth/start`);
  });

  ipcMain.handle(IPC.AUTH_HANDLE_CALLBACK, async (_event, code: string) => {
    const status = await exchangeAuthCode(code);
    send(IPC.AUTH_STATUS_CHANGED, status);
    return status;
  });

  ipcMain.handle(IPC.AUTH_GET_STATUS, async () => {
    return getEntitlementStatus();
  });

  ipcMain.handle(IPC.AUTH_REFRESH, async () => {
    const status = await refreshEntitlement();
    send(IPC.AUTH_STATUS_CHANGED, status);
    return status;
  });

  ipcMain.handle(IPC.AUTH_LOGOUT, async () => {
    logout();
    const status = getEntitlementStatus();
    send(IPC.AUTH_STATUS_CHANGED, status);
    return status;
  });

  // ─── Entitlement gate for queue start ──────────────────────────────

  const originalResume = queueManager.resume.bind(queueManager);
  queueManager.resume = async () => {
    const check = await validateEntitlementForProcessing();
    if (!check.allowed) {
      send(IPC.AUTH_STATUS_CHANGED, getEntitlementStatus());
      throw new Error(check.reason || 'License validation failed');
    }
    originalResume();
  };

  // ─── Apply persisted settings on startup ──────────────────────────

  const startupSettings = database.getAppSettings();
  jobRunner.setTempDir(startupSettings.tempDir || '');
  jobRunner.setPythonPath(startupSettings.pythonPath || 'python');
  jobRunner.setGmfssPath(startupSettings.gmfssPath || '');
}
