// ─── Core Enums & Literals ──────────────────────────────────────────────────

export type EngineId =
  | 'waifu2x'
  | 'realesrgan'
  | 'realcugan'
  | 'anime4k'
  | 'swinir'
  | 'hat';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MediaType = 'image' | 'video';

export type NoiseLevel = -1 | 0 | 1 | 2 | 3;

export type ScaleFactor = 1 | 2 | 4 | 8;

export type TargetFps = 48 | 60 | 120;

export type PipelineOrder = 'INTERPOLATE_ONLY' | 'INTERPOLATE_THEN_UPSCALE' | 'UPSCALE_THEN_INTERPOLATE';

export type SceneChangeHandling = 'AUTO' | 'STRICT' | 'OFF';

export type InterpolationQuality = 'FAST' | 'BALANCED' | 'BEST';

// ─── Interpolation Config ───────────────────────────────────────────────────

export interface InterpolationConfig {
  enabled: boolean;
  engine: 'GMFSS';
  inputFps: number | 'auto';          // 'auto' = detect from video
  targetFps: TargetFps;
  /** Derived multiplier (e.g. 60/24 = 2.5). Computed at job creation. */
  multiplier: number;
  pipelineOrder: PipelineOrder;
  sceneChangeHandling: SceneChangeHandling;
  quality: InterpolationQuality;
  gpuId: number;
}

// ─── Crop / Preview ─────────────────────────────────────────────────────────

export interface CropRegion {
  x: number;
  y: number;
  width: number;   // typically 256
  height: number;  // typically 256
}

export interface PreviewResult {
  beforePath: string;   // path to cropped original
  afterPath: string;    // path to upscaled crop
  elapsedMs: number;
}

// ─── GPU ────────────────────────────────────────────────────────────────────

export interface GpuInfo {
  id: number;
  name: string;
  vendor: string;
  vramMB: number;
}

// ─── System Info ────────────────────────────────────────────────────────────

export interface SystemInfo {
  gpus: GpuInfo[];
  cpuModel: string;
  cpuCores: number;
  ramTotalMB: number;
  ramFreeMB: number;
  diskTotalGB: number;
  diskFreeGB: number;
}

// ─── Job Configuration ──────────────────────────────────────────────────────

export type DeinterlaceMode = 'auto' | 'on' | 'off';

export interface JobConfig {
  engine: EngineId;
  noise: NoiseLevel;
  scale: ScaleFactor;
  tileSize: number;      // 0 = auto
  tta: boolean;
  threads: number;
  gpuId: number;
  model?: string;        // engine-specific model name
  extraArgs?: string[];   // pass-through CLI args
  deinterlace: DeinterlaceMode;
  interpolation?: InterpolationConfig;
}

// ─── Job ────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  name: string;
  inputPaths: string[];
  outputDir: string;
  mediaType: MediaType;
  config: JobConfig;
  status: JobStatus;
  progress: number;          // 0-100
  currentFile?: string;
  totalFiles: number;
  processedFiles: number;
  speed?: number;            // images/min or frames/sec
  vramUsageMB?: number;
  error?: string;
  createdAt: string;         // ISO date
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  stdoutLog: string[];       // live log lines
}

// ─── Preset ─────────────────────────────────────────────────────────────────

export interface Preset {
  id: string;
  name: string;
  description?: string;
  config: JobConfig;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── History Entry ──────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  jobId: string;
  jobName: string;
  engine: EngineId;
  inputPaths: string[];
  outputDir: string;
  status: JobStatus;
  createdAt: string;
  completedAt?: string;
  elapsedMs?: number;
  error?: string;
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface EnginePathConfig {
  waifu2x: string;
  realesrgan: string;
  realcugan: string;
  anime4k: string;
  swinir: string;
  hat: string;
}

export interface AppSettings {
  enginePaths: EnginePathConfig;
  ffmpegPath: string;
  pythonPath: string;        // Python executable for GMFSS, etc.
  gmfssPath: string;         // GMFSS_Fortuna folder path
  defaultOutputDir: string;
  /** Custom temp directory for video frame processing. Empty = auto (same drive as input). */
  tempDir: string;
  defaultPresetId?: string;
  selectedGpuId: number;
  loggingEnabled: boolean;
  maxConcurrentJobs: number;
  autoOpenResult: boolean;
  theme: 'light' | 'dark';
  licenseServerUrl: string;
}

// ─── Engine Abstraction ─────────────────────────────────────────────────────

export interface UpscaleEngine {
  id: EngineId;
  name: string;
  supportedMedia: MediaType[];
  supportedScales: ScaleFactor[];
  supportedNoises: NoiseLevel[];

  /** Maximum scale factor the CLI supports in a single pass (e.g. 2 for waifu2x) */
  maxNativeScale: number;

  /** Whether the engine CLI accepts a directory as -i input (ncnn-vulkan engines do, Anime4KCPP does not) */
  supportsDirectoryInput: boolean;

  /** Build the CLI command + args for a full job */
  buildCommand(job: Job): { cmd: string; args: string[] };

  /** Build the CLI command + args for a single file (used when supportsDirectoryInput=false) */
  buildFileCommand?(inputFile: string, outputFile: string, config: JobConfig): { cmd: string; args: string[] };

  /** Build the CLI command + args for preview-only crop */
  buildPreviewCommand(
    inputPath: string,
    outputPath: string,
    config: JobConfig
  ): { cmd: string; args: string[] };

  /** Parse a stdout line into a progress value (0-100) or null */
  parseProgress(line: string): number | null;

  /** Detect OOM / VRAM error from stderr */
  isOomError(line: string): boolean;
}

// ─── Video Pipeline ─────────────────────────────────────────────────────────

export interface VideoMeta {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  duration: number;    // seconds
  hasAudio: boolean;
  codec: string;
  isInterlaced: boolean;
  fieldOrder: string;   // 'progressive', 'tt', 'bb', 'tb', 'bt', 'unknown'
}

// ─── IPC Channel Names ──────────────────────────────────────────────────────

export const IPC = {
  // Jobs
  JOB_CREATE: 'job:create',
  JOB_CANCEL: 'job:cancel',
  JOB_RETRY: 'job:retry',
  JOB_MOVE: 'job:move',
  JOB_PROGRESS: 'job:progress',
  JOB_STATUS: 'job:status',
  JOB_LOG: 'job:log',
  JOB_LIST: 'job:list',

  // Queue
  QUEUE_PAUSE: 'queue:pause',
  QUEUE_RESUME: 'queue:resume',
  QUEUE_STOP_ALL: 'queue:stopAll',
  QUEUE_STATE: 'queue:state',

  // Preview
  PREVIEW_RUN: 'preview:run',
  PREVIEW_RESULT: 'preview:result',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Presets
  PRESET_LIST: 'preset:list',
  PRESET_SAVE: 'preset:save',
  PRESET_DELETE: 'preset:delete',

  // History
  HISTORY_LIST: 'history:list',
  HISTORY_CLEAR: 'history:clear',

  // System
  SYSTEM_INFO: 'system:info',
  SYSTEM_BENCHMARK: 'system:benchmark',

  // File dialogs
  DIALOG_SELECT_FILES: 'dialog:selectFiles',
  DIALOG_SELECT_DIR: 'dialog:selectDir',

  // Shell
  OPEN_FOLDER: 'shell:openFolder',

  // Engine Install
  ENGINE_STATUS: 'engine:status',
  ENGINE_INSTALL: 'engine:install',
  ENGINE_INSTALL_PROGRESS: 'engine:installProgress',

  // Auth / Licensing
  AUTH_START_LOGIN: 'auth:startLogin',
  AUTH_HANDLE_CALLBACK: 'auth:handleCallback',
  AUTH_GET_STATUS: 'auth:getStatus',
  AUTH_REFRESH: 'auth:refresh',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATUS_CHANGED: 'auth:statusChanged',
} as const;

// ─── Licensing / Entitlement ────────────────────────────────────────────

export interface EntitlementStatus {
  loggedIn: boolean;
  entitled: boolean;
  userId?: string;
  patreonUserId?: string;
  displayName?: string;
  tier?: string;
  issuedAt?: string;
  expiresAt?: string;
  lastVerifiedAt?: string;
  offlineGraceDeadline?: string;   // ISO date — 72h after last verification
  error?: string;
}

export interface AuthExchangeResponse {
  entitlementToken: string;
  refreshToken: string;
  userId: string;
  displayName: string;
  tier: string;
  entitled: boolean;
}
