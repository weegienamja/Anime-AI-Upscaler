import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { Job, HistoryEntry, Preset, AppSettings, EnginePathConfig } from '../shared/types';

/**
 * Local SQLite database for persisting history, presets, and settings.
 */
class AppDatabase {
  private db!: Database.Database;

  init(): void {
    const dbPath = path.join(app.getPath('userData'), 'anime-upscaler.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        jobName TEXT NOT NULL,
        engine TEXT NOT NULL,
        inputPaths TEXT NOT NULL,
        outputDir TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        completedAt TEXT,
        elapsedMs INTEGER,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        config TEXT NOT NULL,
        isDefault INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // ─── History ──────────────────────────────────────────────────────────

  saveHistory(job: Job): void {
    const entry: HistoryEntry = {
      id: job.id + '_' + Date.now(),
      jobId: job.id,
      jobName: job.name,
      engine: job.config.engine,
      inputPaths: job.inputPaths,
      outputDir: job.outputDir,
      status: job.status,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      elapsedMs: job.startedAt && job.completedAt
        ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
        : undefined,
      error: job.error,
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO history (id, jobId, jobName, engine, inputPaths, outputDir, status, createdAt, completedAt, elapsedMs, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.jobId,
        entry.jobName,
        entry.engine,
        JSON.stringify(entry.inputPaths),
        entry.outputDir,
        entry.status,
        entry.createdAt,
        entry.completedAt || null,
        entry.elapsedMs || null,
        entry.error || null
      );
  }

  getHistory(limit = 100): HistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM history ORDER BY createdAt DESC LIMIT ?')
      .all(limit) as any[];

    return rows.map((r) => ({
      ...r,
      inputPaths: JSON.parse(r.inputPaths),
      isDefault: undefined,
    }));
  }

  clearHistory(): void {
    this.db.prepare('DELETE FROM history').run();
  }

  // ─── Presets ──────────────────────────────────────────────────────────

  savePreset(preset: Preset): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO presets (id, name, description, config, isDefault, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        preset.id,
        preset.name,
        preset.description || null,
        JSON.stringify(preset.config),
        preset.isDefault ? 1 : 0,
        preset.createdAt,
        preset.updatedAt
      );
  }

  getPresets(): Preset[] {
    const rows = this.db.prepare('SELECT * FROM presets ORDER BY name').all() as any[];
    return rows.map((r) => ({
      ...r,
      config: JSON.parse(r.config),
      isDefault: r.isDefault === 1,
    }));
  }

  deletePreset(id: string): void {
    this.db.prepare('DELETE FROM presets WHERE id = ?').run(id);
  }

  // ─── Settings ─────────────────────────────────────────────────────────

  getSetting<T>(key: string, defaultValue: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (row) {
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return defaultValue;
      }
    }
    return defaultValue;
  }

  setSetting<T>(key: string, value: T): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(value));
  }

  getAppSettings(): AppSettings {
    const settings = this.getSetting<AppSettings>('appSettings', {
      enginePaths: {
        waifu2x: '',
        realesrgan: '',
        realcugan: '',
        anime4k: '',
        swinir: '',
        hat: '',
      } as EnginePathConfig,
      ffmpegPath: 'ffmpeg',
      pythonPath: 'python',
      gmfssPath: '',
      defaultOutputDir: '',
      tempDir: '',
      selectedGpuId: 0,
      loggingEnabled: true,
      maxConcurrentJobs: 1,
      autoOpenResult: true,
      theme: 'dark',
      licenseServerUrl: 'https://YOUR_DOMAIN',
    });

    // Auto-detect Python 3.11 if still at default 'python'
    if (!settings.pythonPath || settings.pythonPath === 'python') {
      const py311Candidates = [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
        'C:\\Python311\\python.exe',
        'C:\\Python310\\python.exe',
      ];
      for (const candidate of py311Candidates) {
        if (candidate && fs.existsSync(candidate)) {
          settings.pythonPath = candidate;
          break;
        }
      }
    }

    // Auto-detect GMFSS_Fortuna if still empty
    if (!settings.gmfssPath) {
      // __dirname = .../app/dist/main, process.cwd() = .../app
      // GMFSS_Fortuna lives alongside the repo root (e.g. D:\Anime upscaler\GMFSS_Fortuna)
      const gmfssCandidates = [
        path.resolve(path.join(process.cwd(), '..', '..', 'GMFSS_Fortuna')),  // app → waifu2x → Anime upscaler
        path.resolve(path.join(process.cwd(), '..', 'GMFSS_Fortuna')),        // app → waifu2x
        path.resolve(path.join(__dirname, '..', '..', '..', '..', '..', 'GMFSS_Fortuna')), // dist/main → ... → Anime upscaler
        path.resolve(path.join(__dirname, '..', '..', '..', '..', 'GMFSS_Fortuna')),
      ];
      for (const candidate of gmfssCandidates) {
        if (fs.existsSync(path.join(candidate, 'train_log'))) {
          settings.gmfssPath = candidate;
          break;
        }
      }
    }

    return settings;
  }

  setAppSettings(settings: AppSettings): void {
    this.setSetting('appSettings', settings);
  }
}

export const database = new AppDatabase();
