import { contextBridge, ipcRenderer } from 'electron';
import { IPC, JobConfig, CropRegion, AppSettings, Preset } from '../shared/types';

/**
 * Exposes a safe API from the main process to the renderer
 * via contextBridge.
 */
const api = {
  // ─── Jobs ─────────────────────────────────────────────────────────
  createJob: (params: {
    name: string;
    inputPaths: string[];
    outputDir: string;
    mediaType: 'image' | 'video';
    config: JobConfig;
    runNow?: boolean;
  }) => ipcRenderer.invoke(IPC.JOB_CREATE, params),

  cancelJob: (jobId: string) => ipcRenderer.invoke(IPC.JOB_CANCEL, jobId),

  retryJob: (jobId: string) => ipcRenderer.invoke(IPC.JOB_RETRY, jobId),

  moveJob: (jobId: string, direction: 'up' | 'down') =>
    ipcRenderer.invoke(IPC.JOB_MOVE, jobId, direction),

  listJobs: () => ipcRenderer.invoke(IPC.JOB_LIST),

  // ─── Queue ────────────────────────────────────────────────────────
  pauseQueue: () => ipcRenderer.invoke(IPC.QUEUE_PAUSE),
  resumeQueue: () => ipcRenderer.invoke(IPC.QUEUE_RESUME),
  stopAll: () => ipcRenderer.invoke(IPC.QUEUE_STOP_ALL),
  getQueueState: () => ipcRenderer.invoke(IPC.QUEUE_STATE),

  // ─── Preview ──────────────────────────────────────────────────────
  runPreview: (params: {
    inputPath: string;
    config: JobConfig;
    cropRegion: CropRegion;
  }) => ipcRenderer.invoke(IPC.PREVIEW_RUN, params),

  // ─── Settings ─────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  setSettings: (settings: AppSettings) =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, settings),

  // ─── Presets ──────────────────────────────────────────────────────
  listPresets: () => ipcRenderer.invoke(IPC.PRESET_LIST),
  savePreset: (preset: Preset) => ipcRenderer.invoke(IPC.PRESET_SAVE, preset),
  deletePreset: (presetId: string) =>
    ipcRenderer.invoke(IPC.PRESET_DELETE, presetId),

  // ─── History ──────────────────────────────────────────────────────
  listHistory: () => ipcRenderer.invoke(IPC.HISTORY_LIST),
  clearHistory: () => ipcRenderer.invoke(IPC.HISTORY_CLEAR),

  // ─── System ───────────────────────────────────────────────────────
  getSystemInfo: () => ipcRenderer.invoke(IPC.SYSTEM_INFO),
  runBenchmark: () => ipcRenderer.invoke(IPC.SYSTEM_BENCHMARK),

  // ─── Dialogs ──────────────────────────────────────────────────────
  selectFiles: () => ipcRenderer.invoke(IPC.DIALOG_SELECT_FILES),
  selectDirectory: () => ipcRenderer.invoke(IPC.DIALOG_SELECT_DIR),
  openFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC.OPEN_FOLDER, folderPath),

  // ─── Engine Install ────────────────────────────────────────────────
  getEngineStatuses: () => ipcRenderer.invoke(IPC.ENGINE_STATUS),
  installEngine: (engineId: string) => ipcRenderer.invoke(IPC.ENGINE_INSTALL, engineId),

  // ─── Event Listeners ──────────────────────────────────────────────
  onJobProgress: (callback: (data: { jobId: string; progress: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC.JOB_PROGRESS, handler);
    return () => { ipcRenderer.removeListener(IPC.JOB_PROGRESS, handler); };
  },

  onJobStatus: (callback: (job: any) => void) => {
    const handler = (_event: any, job: any) => callback(job);
    ipcRenderer.on(IPC.JOB_STATUS, handler);
    return () => { ipcRenderer.removeListener(IPC.JOB_STATUS, handler); };
  },

  onJobLog: (callback: (data: { jobId: string; line: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC.JOB_LOG, handler);
    return () => { ipcRenderer.removeListener(IPC.JOB_LOG, handler); };
  },

  onQueueState: (callback: (state: any) => void) => {
    const handler = (_event: any, state: any) => callback(state);
    ipcRenderer.on(IPC.QUEUE_STATE, handler);
    return () => { ipcRenderer.removeListener(IPC.QUEUE_STATE, handler); };
  },

  onEngineInstallProgress: (callback: (progress: any) => void) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on(IPC.ENGINE_INSTALL_PROGRESS, handler);
    return () => { ipcRenderer.removeListener(IPC.ENGINE_INSTALL_PROGRESS, handler); };
  },

  // ─── Auth / Licensing ─────────────────────────────────────────────
  startLogin: () => ipcRenderer.invoke(IPC.AUTH_START_LOGIN),
  handleAuthCallback: (code: string) =>
    ipcRenderer.invoke(IPC.AUTH_HANDLE_CALLBACK, code),
  getAuthStatus: () => ipcRenderer.invoke(IPC.AUTH_GET_STATUS),
  refreshAuth: () => ipcRenderer.invoke(IPC.AUTH_REFRESH),
  logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),

  onAuthStatusChanged: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on(IPC.AUTH_STATUS_CHANGED, handler);
    return () => { ipcRenderer.removeListener(IPC.AUTH_STATUS_CHANGED, handler); };
  },
};

contextBridge.exposeInMainWorld('api', api);

// TypeScript declaration for renderer
export type ElectronAPI = typeof api;
