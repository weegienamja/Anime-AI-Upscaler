import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { EngineId } from '../shared/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EngineRegistryEntry {
  id: EngineId;
  name: string;
  description: string;
  repo: string;               // "owner/repo" on GitHub
  exeName: string;             // executable name without .exe
  assetPattern: RegExp;        // regex to match the Windows zip asset name
  requiresPython: boolean;
}

export interface EngineStatus {
  id: EngineId;
  name: string;
  description: string;
  installed: boolean;
  installPath: string;
  requiresPython: boolean;
}

export interface InstallProgress {
  engineId: EngineId;
  stage: 'downloading' | 'extracting' | 'done' | 'error';
  percent: number;
  message: string;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const REGISTRY: EngineRegistryEntry[] = [
  {
    id: 'waifu2x',
    name: 'Waifu2x',
    description: 'Classic anime upscaler with denoising. Best for anime/manga.',
    repo: 'nihui/waifu2x-ncnn-vulkan',
    exeName: 'waifu2x-ncnn-vulkan',
    assetPattern: /windows.*\.zip$/i,
    requiresPython: false,
  },
  {
    id: 'realesrgan',
    name: 'Real-ESRGAN',
    description: 'General-purpose upscaler. Great for anime and photos.',
    repo: 'xinntao/Real-ESRGAN',
    exeName: 'realesrgan-ncnn-vulkan',
    assetPattern: /realesrgan-ncnn-vulkan.*windows.*\.zip$/i,
    requiresPython: false,
  },
  {
    id: 'realcugan',
    name: 'Real-CUGAN',
    description: 'Anime upscaler with conservative denoising.',
    repo: 'nihui/realcugan-ncnn-vulkan',
    exeName: 'realcugan-ncnn-vulkan',
    assetPattern: /windows.*\.zip$/i,
    requiresPython: false,
  },
  {
    id: 'anime4k',
    name: 'Anime4K',
    description: 'Fast shader-based anime upscaler. Near real-time.',
    repo: 'TianZerL/Anime4KCPP',
    exeName: 'ac_cli',
    assetPattern: /CLI.*x64.*MSVC.*\.7z$/i,
    requiresPython: false,
  },
  {
    id: 'swinir',
    name: 'SwinIR',
    description: 'Transformer-based image restoration. Requires Python + PyTorch.',
    repo: '',
    exeName: 'python',
    assetPattern: /^$/,
    requiresPython: true,
  },
  {
    id: 'hat',
    name: 'HAT',
    description: 'Hybrid Attention Transformer. Highest quality. Requires Python.',
    repo: '',
    exeName: 'python',
    assetPattern: /^$/,
    requiresPython: true,
  },
];

// ─── Installer ──────────────────────────────────────────────────────────────

class EngineInstaller extends EventEmitter {
  private binDir = '';
  private installing = new Set<EngineId>();

  init(): void {
    const appDir = app.getAppPath();
    const workspaceDir = path.dirname(appDir);
    this.binDir = path.join(workspaceDir, 'bin');
    fs.mkdirSync(this.binDir, { recursive: true });
  }

  getRegistry(): EngineRegistryEntry[] {
    return REGISTRY;
  }

  /** Check install status of every engine */
  getEngineStatuses(): EngineStatus[] {
    return REGISTRY.map((entry) => {
      const { installed, installPath } = this.findEngine(entry);
      return {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        installed,
        installPath,
        requiresPython: entry.requiresPython,
      };
    });
  }

  /** Get status of a single engine */
  getStatus(engineId: EngineId): EngineStatus | undefined {
    return this.getEngineStatuses().find((s) => s.id === engineId);
  }

  isInstalling(engineId: EngineId): boolean {
    return this.installing.has(engineId);
  }

  /** Download and install an engine from its latest GitHub release */
  async install(engineId: EngineId): Promise<string> {
    const entry = REGISTRY.find((r) => r.id === engineId);
    if (!entry) throw new Error(`Unknown engine: ${engineId}`);
    if (entry.requiresPython) throw new Error(`${entry.name} requires Python — install manually.`);
    if (!entry.repo) throw new Error(`No download source for ${entry.name}.`);
    if (this.installing.has(engineId)) throw new Error(`${entry.name} is already being installed.`);

    this.installing.add(engineId);

    try {
      // 1. Fetch latest release from GitHub
      this.emitProgress(engineId, 'downloading', 0, 'Finding latest release…');
      const release = await this.fetchJson(
        `https://api.github.com/repos/${entry.repo}/releases/latest`
      );

      const asset = release.assets?.find((a: any) => entry.assetPattern.test(a.name));
      if (!asset) {
        throw new Error(
          `No Windows release asset found for ${entry.name}. Visit https://github.com/${entry.repo}/releases to download manually.`
        );
      }

      // 2. Download the zip
      const sizeMB = (asset.size / 1024 / 1024).toFixed(1);
      this.emitProgress(engineId, 'downloading', 5, `Downloading ${asset.name} (${sizeMB} MB)…`);
      const ext = asset.name.endsWith('.7z') ? '.7z' : '.zip';
      const zipPath = path.join(os.tmpdir(), `${engineId}-install${ext}`);

      await this.downloadFile(asset.browser_download_url, zipPath, asset.size, (pct) => {
        this.emitProgress(engineId, 'downloading', 5 + pct * 0.80, `Downloading… ${Math.round(pct)}%`);
      });

      // 3. Extract
      this.emitProgress(engineId, 'extracting', 88, 'Extracting…');
      if (zipPath.endsWith('.7z')) {
        await this.extract7z(zipPath, this.binDir);
      } else {
        await this.extractZip(zipPath, this.binDir);
      }

      // 4. Cleanup temp
      try { fs.unlinkSync(zipPath); } catch { /* best effort */ }

      // 5. Verify
      const { installed, installPath } = this.findEngine(entry);
      if (!installed) {
        throw new Error(`Extraction completed but ${entry.exeName} executable not found in bin/.`);
      }

      this.emitProgress(engineId, 'done', 100, `${entry.name} installed!`);
      return installPath;
    } catch (err: any) {
      this.emitProgress(engineId, 'error', 0, err.message);
      throw err;
    } finally {
      this.installing.delete(engineId);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private findEngine(entry: EngineRegistryEntry): { installed: boolean; installPath: string } {
    if (entry.requiresPython) {
      try {
        require('child_process').execSync('python --version', { stdio: 'pipe' });
        return { installed: true, installPath: 'python' };
      } catch {
        return { installed: false, installPath: '' };
      }
    }

    const exeName = process.platform === 'win32' ? `${entry.exeName}.exe` : entry.exeName;

    // Scan bin/ subdirectories (release zips extract into named folders)
    if (fs.existsSync(this.binDir)) {
      try {
        for (const sub of fs.readdirSync(this.binDir)) {
          const subPath = path.join(this.binDir, sub);
          if (fs.statSync(subPath).isDirectory()) {
            const exePath = path.join(subPath, exeName);
            if (fs.existsSync(exePath) && fs.statSync(exePath).isFile()) {
              return { installed: true, installPath: exePath };
            }
          }
        }
      } catch { /* skip */ }
    }

    // Directly in bin/
    const directPath = path.join(this.binDir, exeName);
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
      return { installed: true, installPath: directPath };
    }

    return { installed: false, installPath: '' };
  }

  private emitProgress(
    engineId: EngineId,
    stage: InstallProgress['stage'],
    percent: number,
    message: string
  ): void {
    this.emit('progress', { engineId, stage, percent, message } as InstallProgress);
  }

  private fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: {
          'User-Agent': 'AnimeUpscaler/1.0',
          Accept: 'application/json',
        },
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          this.fetchJson(res.headers.location!).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  private downloadFile(
    url: string,
    destPath: string,
    expectedSize: number,
    onProgress: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const follow = (downloadUrl: string) => {
        const proto = downloadUrl.startsWith('https') ? https : require('http');
        proto.get(downloadUrl, {
          headers: { 'User-Agent': 'AnimeUpscaler/1.0' },
        }, (res: any) => {
          // Follow redirects (GitHub uses 302 for release downloads)
          if (res.statusCode === 301 || res.statusCode === 302) {
            follow(res.headers.location!);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const totalSize = parseInt(res.headers['content-length'] || String(expectedSize), 10);
          const file = fs.createWriteStream(destPath);
          let downloaded = 0;

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            file.write(chunk);
            if (totalSize > 0) onProgress((downloaded / totalSize) * 100);
          });

          res.on('end', () => {
            file.end();
            file.on('finish', () => resolve());
          });

          res.on('error', (err: Error) => {
            file.close();
            reject(err);
          });
        }).on('error', reject);
      };

      follow(url);
    });
  }

  private extractZip(zipPath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd =
        process.platform === 'win32'
          ? `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`
          : `unzip -o "${zipPath}" -d "${destDir}"`;

      exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 }, (error) => {
        if (error) reject(new Error(`Extraction failed: ${error.message}`));
        else resolve();
      });
    });
  }

  private extract7z(archivePath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try common 7-Zip install locations
      const sevenZipPaths = [
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe',
      ];
      const sevenZip = sevenZipPaths.find((p) => fs.existsSync(p)) || '7z';
      const cmd = `"${sevenZip}" x "${archivePath}" -o"${destDir}" -y`;

      exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 }, (error) => {
        if (error) reject(new Error(`7z extraction failed: ${error.message}. Is 7-Zip installed?`));
        else resolve();
      });
    });
  }
}

export const engineInstaller = new EngineInstaller();
