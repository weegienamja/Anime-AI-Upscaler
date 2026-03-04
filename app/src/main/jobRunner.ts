import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Job, UpscaleEngine, InterpolationConfig } from '../shared/types';
import { engineManager } from './engineManager';
import { ffmpegPipeline } from './ffmpegPipeline';

const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'webm', 'mov', 'flv', 'wmv', 'ts', 'm4v']);

/**
 * Get free disk space in bytes for the drive containing a given path.
 */
function getFreeDiskSpace(dirPath: string): number {
  try {
    if (process.platform === 'win32') {
      const drive = path.parse(path.resolve(dirPath)).root; // e.g. "C:\\"
      const output = execSync(
        `powershell -NoProfile -Command "(Get-PSDrive ${drive[0]}).Free"`,
        { encoding: 'utf8', windowsHide: true, timeout: 10000 }
      ).trim();
      return parseInt(output, 10) || 0;
    } else {
      const stats = fs.statfsSync(dirPath);
      return stats.bfree * stats.bsize;
    }
  } catch {
    return Infinity; // can't determine — skip the check
  }
}

/**
 * Estimate temp disk space needed for a video job (bytes).
 * Accounts for extracted frames + largest upscale pass output.
 */
function estimateTempSpaceNeeded(
  frameCount: number,
  width: number,
  height: number,
  totalScale: number
): number {
  // PNG compressed ≈ 0.5 bytes per pixel on average (varies widely)
  const bytesPerPixel = 0.5;

  // Extracted frames (original resolution)
  const inputFrameBytes = width * height * bytesPerPixel;
  const extractedTotal = inputFrameBytes * frameCount;

  // Largest pass output: final resolution frames
  const finalW = width * totalScale;
  const finalH = height * totalScale;
  const outputFrameBytes = finalW * finalH * bytesPerPixel;
  const outputTotal = outputFrameBytes * frameCount;

  // Need space for: extracted frames + one pass of output frames (intermediate passes clean up)
  // Add 20% safety margin
  return Math.ceil((extractedTotal + outputTotal) * 1.2);
}

function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  return VIDEO_EXTS.has(ext);
}

export interface JobRunnerEvents {
  progress: (jobId: string, progress: number) => void;
  log: (jobId: string, line: string) => void;
  completed: (jobId: string) => void;
  failed: (jobId: string, error: string) => void;
  oom: (jobId: string) => void;
}

/**
 * Spawns upscale job processes, streams stdout/stderr,
 * parses progress, detects OOM errors, and orchestrates
 * the video pipeline (extract → upscale → reassemble).
 */
export class JobRunner extends EventEmitter {
  private processes = new Map<string, ChildProcess>();
  private aborted = new Set<string>();

  /**
   * Custom temp directory. Empty string = auto (same drive as input file).
   */
  private _tempDir = '';

  /** Python executable path */
  private _pythonPath = 'python';

  /** GMFSS_Fortuna folder path */
  private _gmfssPath = '';

  /**
   * Set the temp working directory for video processing.
   * Pass empty string for auto (uses input file's drive).
   */
  setTempDir(dir: string): void {
    this._tempDir = dir;
  }

  setPythonPath(p: string): void {
    this._pythonPath = p || 'python';
  }

  setGmfssPath(p: string): void {
    this._gmfssPath = p;
  }

  /**
   * Resolve the temp base directory for a given job.
   * Priority: custom setting → input file's parent directory temp → os.tmpdir()
   */
  private resolveTempBase(job: Job): string {
    // 1. Custom temp directory from settings
    if (this._tempDir && this._tempDir.trim()) {
      const base = path.join(this._tempDir.trim(), 'anime-upscaler-video', job.id);
      return base;
    }

    // 2. Auto: use same drive as the input file or output directory to avoid cross-drive issues
    const inputDir = path.dirname(job.inputPaths[0]);
    const inputDrive = path.parse(path.resolve(inputDir)).root;
    const osTmpDrive = path.parse(os.tmpdir()).root;

    if (inputDrive.toLowerCase() !== osTmpDrive.toLowerCase()) {
      // Input is on a different drive than system temp — use input drive
      const base = path.join(inputDrive, 'anime-upscaler-temp', job.id);
      return base;
    }

    // 3. Default: system temp directory
    return path.join(os.tmpdir(), 'anime-upscaler-video', job.id);
  }

  /**
   * Compute the list of per-pass scales needed.
   * E.g. for waifu2x (maxNative=2), requestedScale=8 → [2, 2, 2]
   *      for realesrgan (maxNative=4), requestedScale=8 → [4, 2]
   */
  private computePasses(requestedScale: number, maxNativeScale: number): number[] {
    if (requestedScale <= maxNativeScale) return [requestedScale];
    const passes: number[] = [];
    let remaining = requestedScale;
    while (remaining > 1) {
      const passScale = Math.min(remaining, maxNativeScale);
      passes.push(passScale);
      remaining = remaining / passScale;
    }
    return passes;
  }

  /**
   * Spawn an engine process and return a promise that resolves on exit code 0.
   */
  private spawnEngine(
    jobId: string,
    engine: UpscaleEngine,
    cmd: string,
    args: string[],
    onProgress?: (pct: number) => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd: path.dirname(cmd) !== '.' ? path.dirname(cmd) : undefined,
        windowsHide: true,
      });

      this.processes.set(jobId, proc);

      const handleData = (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          this.emit('log', jobId, line);

          if (engine.isOomError(line)) {
            this.emit('oom', jobId);
          }

          const pct = engine.parseProgress(line);
          if (pct !== null) {
            onProgress?.(pct);
          }
        }
      };

      proc.stdout?.on('data', handleData);
      proc.stderr?.on('data', handleData);

      proc.on('close', (code) => {
        this.processes.delete(jobId);
        if (this.aborted.has(jobId)) {
          this.aborted.delete(jobId);
          reject(new Error('Job was cancelled'));
          return;
        }
        if (code === 0) resolve();
        else reject(new Error(`Engine process exited with code ${code}`));
      });

      proc.on('error', (err) => {
        this.processes.delete(jobId);
        const msg = err.message.includes('ENOENT')
          ? `Engine executable not found: "${cmd}". Set the path in Settings.`
          : err.message;
        reject(new Error(msg));
      });
    });
  }

  /**
   * Run frame interpolation using GMFSS_Fortuna via Python wrapper.
   */
  private interpolateFrames(
    jobId: string,
    inputDir: string,
    outputDir: string,
    interp: InterpolationConfig,
    inputFps: number,
    onProgress?: (pct: number) => void
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const scriptPath = path.join(__dirname, '..', '..', 'tools', 'gmfss', 'run_gmfss.py');
      const resolvedScript = fs.existsSync(scriptPath)
        ? scriptPath
        : path.join(process.cwd(), 'tools', 'gmfss', 'run_gmfss.py');

      if (!fs.existsSync(resolvedScript)) {
        return reject(new Error(`GMFSS wrapper script not found at: ${scriptPath}`));
      }
      if (!this._gmfssPath) {
        return reject(new Error('GMFSS_Fortuna path not configured. Set it in Settings → GMFSS Path.'));
      }

      const realInputFps = interp.inputFps === 'auto' ? inputFps : interp.inputFps;
      const args = [
        resolvedScript,
        '--input_dir', inputDir,
        '--output_dir', outputDir,
        '--input_fps', String(realInputFps),
        '--target_fps', String(interp.targetFps),
        '--quality', interp.quality,
        '--scene', interp.sceneChangeHandling,
        '--gpu_id', String(interp.gpuId),
        '--gmfss_path', this._gmfssPath,
      ];

      this.emit('log', jobId, `[Interpolation] ${this._pythonPath} ${args.join(' ')}`);

      const proc = spawn(this._pythonPath, args, { windowsHide: true });
      this.processes.set(`${jobId}_interp`, proc);

      const handleData = (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          this.emit('log', jobId, `[GMFSS] ${line}`);

          const progressMatch = line.match(/^PROGRESS:(\d+)/);
          if (progressMatch) {
            onProgress?.(parseInt(progressMatch[1], 10));
          }

          if (line.startsWith('SCENE_CHANGE:')) {
            this.emit('log', jobId, `[GMFSS] Scene change detected at frame ${line.split(':')[1]}`);
          }

          if (line.startsWith('ERROR:')) {
            this.emit('log', jobId, `[GMFSS] Error: ${line.slice(6)}`);
          }
        }
      };

      proc.stdout?.on('data', handleData);
      proc.stderr?.on('data', handleData);

      proc.on('close', (code) => {
        this.processes.delete(`${jobId}_interp`);
        if (this.aborted.has(jobId)) {
          reject(new Error('Job was cancelled'));
          return;
        }
        if (code === 0) resolve();
        else reject(new Error(`GMFSS interpolation exited with code ${code}`));
      });

      proc.on('error', (err) => {
        this.processes.delete(`${jobId}_interp`);
        const msg = err.message.includes('ENOENT')
          ? `Python not found: "${this._pythonPath}". Install Python and set the path in Settings.`
          : err.message;
        reject(new Error(msg));
      });
    });
  }

  /**
   * Run a job — dispatches to image or video pipeline.
   */
  async run(job: Job): Promise<void> {
    const interp = job.config.interpolation;
    const isInterpOnly = interp?.enabled === true && interp?.pipelineOrder === 'INTERPOLATE_ONLY';

    const engine = engineManager.get(job.config.engine);
    if (!engine && !isInterpOnly) {
      throw new Error(`Engine "${job.config.engine}" not registered`);
    }

    // Validate that the engine executable exists (skip for interpolation-only)
    if (engine && !isInterpOnly) {
      const { cmd } = engine.buildCommand(job);
      if (!this.executableExists(cmd)) {
        const msg =
          `Engine executable not found: "${cmd}". ` +
          `Please set the correct path in Settings → Engine Executables.`;
        throw new Error(msg);
      }
    }

    // Decide pipeline based on input file
    const firstInput = job.inputPaths[0];
    if (job.mediaType === 'video' || isVideoFile(firstInput)) {
      // Validate ffmpeg/ffprobe are available for video processing
      if (!this.executableExists(ffmpegPipeline.getFfmpegPath())) {
        throw new Error(
          `FFmpeg not found ("${ffmpegPipeline.getFfmpegPath()}"). ` +
          `Please install FFmpeg and set the path in Settings → FFmpeg, or add it to your system PATH.`
        );
      }
      if (!this.executableExists(ffmpegPipeline.getFfprobePath())) {
        throw new Error(
          `FFprobe not found ("${ffmpegPipeline.getFfprobePath()}"). ` +
          `FFprobe is included with FFmpeg. Please install FFmpeg and set the path in Settings → FFmpeg.`
        );
      }
      return this.runVideoJob(job, engine!);
    }

    if (!engine) {
      throw new Error('Interpolation-only mode is only available for video files.');
    }
    return this.runImageJob(job, engine);
  }

  /**
   * Run a single-image (or batch-image) job by spawning the engine process.
   * Supports multi-pass for scales > engine's maxNativeScale.
   */
  private async runImageJob(job: Job, engine: UpscaleEngine): Promise<void> {
    const passes = this.computePasses(job.config.scale, engine.maxNativeScale);

    if (passes.length === 1) {
      // Single pass — straightforward
      const { cmd, args } = engine.buildCommand(job);
      this.emit('log', job.id, `> ${cmd} ${args.join(' ')}`);

      await this.spawnEngine(job.id, engine, cmd, args, (pct) => {
        this.emit('progress', job.id, Math.min(100, Math.max(0, pct)));
      });

      this.emit('progress', job.id, 100);
      this.emit('completed', job.id);
    } else {
      // Multi-pass: create temp dirs for intermediate results
      const tmpBase = this._tempDir?.trim()
        ? path.join(this._tempDir.trim(), 'anime-upscaler-multipass', job.id)
        : path.join(os.tmpdir(), 'anime-upscaler-multipass', job.id);
      fs.mkdirSync(tmpBase, { recursive: true });

      this.emit('log', job.id, `[Multi-pass] ${job.config.scale}x requires ${passes.length} passes: ${passes.map(s => s + 'x').join(' → ')}`);

      let currentInput = job.inputPaths[0];

      for (let i = 0; i < passes.length; i++) {
        if (this.aborted.has(job.id)) throw new Error('Job was cancelled');

        const passScale = passes[i];
        const isLast = i === passes.length - 1;
        const passOutput = isLast ? job.outputDir : path.join(tmpBase, `pass${i + 1}`);

        if (!isLast) fs.mkdirSync(passOutput, { recursive: true });

        const passJob: Job = {
          ...job,
          inputPaths: [currentInput],
          outputDir: passOutput,
          config: { ...job.config, scale: passScale as any },
        };

        const { cmd, args } = engine.buildCommand(passJob);
        this.emit('log', job.id, `[Multi-pass] Pass ${i + 1}/${passes.length} (${passScale}x): ${cmd} ${args.join(' ')}`);

        const passBase = (i / passes.length) * 100;
        const passRange = (1 / passes.length) * 100;

        await this.spawnEngine(job.id, engine, cmd, args, (pct) => {
          const overall = passBase + (pct / 100) * passRange;
          this.emit('progress', job.id, Math.min(99, overall));
        });

        // For next pass, input is the output of this pass
        if (!isLast) {
          // Find the output file(s) in the pass directory
          const outputFiles = fs.readdirSync(passOutput);
          if (outputFiles.length > 0) {
            currentInput = path.join(passOutput, outputFiles[0]);
          }
        }
      }

      // Cleanup temp
      try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* best effort */ }

      this.emit('progress', job.id, 100);
      this.emit('completed', job.id);
    }
  }

  /**
   * Run a video job through the full pipeline:
   *   1. Extract frames with ffmpeg
   *   2. (Optional) Interpolate frames with GMFSS
   *   3. Upscale frames folder with the engine
   *   4. Reassemble frames into output video
   *
   * Pipeline order for interpolation:
   *   INTERPOLATE_THEN_UPSCALE: extract → interpolate → upscale → reassemble
   *   UPSCALE_THEN_INTERPOLATE: extract → upscale → interpolate → reassemble
   */
  private async runVideoJob(job: Job, engine: UpscaleEngine | null): Promise<void> {
    const videoPath = job.inputPaths[0];
    const baseName = path.basename(videoPath, path.extname(videoPath));
    const resolvedOutputDir = path.resolve(job.outputDir);
    fs.mkdirSync(resolvedOutputDir, { recursive: true });

    const interp = job.config.interpolation;
    const hasInterp = interp?.enabled === true;
    const interpOrder = interp?.pipelineOrder || 'INTERPOLATE_THEN_UPSCALE';

    const isInterpOnly = hasInterp && interpOrder === 'INTERPOLATE_ONLY';

    // Build output filename suffix
    const scaleSuffix = isInterpOnly ? '' : `_${job.config.scale}x`;
    const interpSuffix = hasInterp ? `_${interp!.targetFps}fps` : '';
    const outputVideoPath = path.join(
      resolvedOutputDir,
      `${baseName}${scaleSuffix}${interpSuffix}${path.extname(videoPath)}`
    );

    // Create temp working dirs
    const tmpBase = this.resolveTempBase(job);
    const inputFramesDir = path.join(tmpBase, 'frames_in');
    const outputFramesDir = path.join(tmpBase, 'frames_out');
    const interpFramesDir = path.join(tmpBase, 'frames_interp');
    fs.mkdirSync(inputFramesDir, { recursive: true });
    fs.mkdirSync(outputFramesDir, { recursive: true });
    if (hasInterp) fs.mkdirSync(interpFramesDir, { recursive: true });

    this.emit('log', job.id, `[Pipeline] Temp directory: ${tmpBase}`);
    if (hasInterp) {
      this.emit('log', job.id, `[Pipeline] Interpolation: ${interpOrder}, target ${interp!.targetFps}fps, quality=${interp!.quality}`);
    }

    // ── Progress allocation ──
    // Without interpolation: extract=0-20, upscale=20-90, reassemble=90-100
    // Interpolate only: extract=0-10, interp=10-88, reassemble=88-100
    // With interp INTERPOLATE_THEN_UPSCALE: extract=0-10, interp=10-35, upscale=35-88, reassemble=88-100
    // With interp UPSCALE_THEN_INTERPOLATE: extract=0-10, upscale=10-55, interp=55-88, reassemble=88-100
    const P = isInterpOnly
      ? { extract: [0, 10], step1: [10, 88], step2: [88, 88], reassemble: [88, 100] }
      : hasInterp
        ? interpOrder === 'INTERPOLATE_THEN_UPSCALE'
          ? { extract: [0, 10], step1: [10, 35], step2: [35, 88], reassemble: [88, 100] }
          : { extract: [0, 10], step1: [10, 55], step2: [55, 88], reassemble: [88, 100] }
        : { extract: [0, 20], step1: [20, 90], step2: [90, 90], reassemble: [90, 100] };

    try {
      // ── Step 1: Probe ──
      this.emit('log', job.id, '[Pipeline] Probing video...');
      const meta = await ffmpegPipeline.probe(videoPath);
      this.emit(
        'log',
        job.id,
        `[Pipeline] ${meta.width}x${meta.height} @ ${meta.fps.toFixed(2)}fps, ~${meta.frameCount} frames, audio=${meta.hasAudio}`
      );

      // ── Disk space check ──
      const interpMultiplier = hasInterp ? (interp!.targetFps / meta.fps) : 1;
      const estimatedBytes = estimateTempSpaceNeeded(
        Math.ceil(meta.frameCount * interpMultiplier),
        meta.width,
        meta.height,
        job.config.scale
      );
      const freeBytes = getFreeDiskSpace(tmpBase);
      const estimatedGB = (estimatedBytes / (1024 ** 3)).toFixed(1);
      const freeGB = (freeBytes / (1024 ** 3)).toFixed(1);
      this.emit('log', job.id, `[Pipeline] Estimated temp space: ~${estimatedGB} GB, available: ${freeGB} GB`);

      if (freeBytes < estimatedBytes) {
        const tmpDrive = path.parse(path.resolve(tmpBase)).root;
        throw new Error(
          `Insufficient disk space on ${tmpDrive}: need ~${estimatedGB} GB but only ${freeGB} GB free. ` +
          `Change the Temp Working Directory in Settings to a drive with more space.`
        );
      }

      // ── Step 2: Extract frames ──
      const deintMode = job.config.deinterlace || 'auto';
      if (meta.isInterlaced) {
        this.emit('log', job.id, `[Pipeline] Interlaced video detected (field_order=${meta.fieldOrder}), deinterlace=${deintMode}`);
      }
      this.emit('log', job.id, '[Pipeline] Extracting frames...');
      this.emit('progress', job.id, P.extract[0]);
      await ffmpegPipeline.extractFrames(videoPath, inputFramesDir, (frame, total) => {
        if (total > 0) {
          const pct = P.extract[0] + (frame / total) * (P.extract[1] - P.extract[0]);
          this.emit('progress', job.id, Math.min(P.extract[1], pct));
        }
      }, deintMode);
      this.emit('log', job.id, '[Pipeline] Frame extraction complete');

      if (this.aborted.has(job.id)) throw new Error('Job was cancelled');

      // ── Determine pipeline step order ──
      let upscaleInputDir: string;
      let upscaleOutputDir: string;
      let finalFramesDir: string;
      let finalFps = meta.fps;

      if (isInterpOnly) {
        // ── Interpolation only — no upscaling ──
        this.emit('log', job.id, '[Pipeline] Interpolation only mode (no upscaling)');
        await this.interpolateFrames(
          job.id, inputFramesDir, interpFramesDir, interp!, meta.fps,
          (pct) => {
            const mapped = P.step1[0] + (pct / 100) * (P.step1[1] - P.step1[0]);
            this.emit('progress', job.id, Math.min(P.step1[1], mapped));
          }
        );
        this.emit('log', job.id, '[Pipeline] Interpolation complete');

        finalFramesDir = interpFramesDir;
        finalFps = interp!.targetFps;
      } else if (hasInterp && interpOrder === 'INTERPOLATE_THEN_UPSCALE') {
        // ── Interpolate FIRST, then Upscale ──

        // Step A: Interpolate  extracted→interpolated
        this.emit('log', job.id, '[Pipeline] Interpolating frames (before upscale)...');
        await this.interpolateFrames(
          job.id, inputFramesDir, interpFramesDir, interp!, meta.fps,
          (pct) => {
            const mapped = P.step1[0] + (pct / 100) * (P.step1[1] - P.step1[0]);
            this.emit('progress', job.id, Math.min(P.step1[1], mapped));
          }
        );
        this.emit('log', job.id, '[Pipeline] Interpolation complete');
        if (this.aborted.has(job.id)) throw new Error('Job was cancelled');

        upscaleInputDir = interpFramesDir;
        upscaleOutputDir = outputFramesDir;
        finalFramesDir = outputFramesDir;
        finalFps = interp!.targetFps;

        // Step B: Upscale interpolated→output
        await this.runUpscalePasses(
          job, engine!, upscaleInputDir, upscaleOutputDir, tmpBase,
          P.step2[0], P.step2[1]
        );
      } else if (hasInterp && interpOrder === 'UPSCALE_THEN_INTERPOLATE') {
        // ── Upscale FIRST, then Interpolate ──

        // Step A: Upscale extracted→upscaled
        upscaleInputDir = inputFramesDir;
        upscaleOutputDir = outputFramesDir;

        await this.runUpscalePasses(
          job, engine!, upscaleInputDir, upscaleOutputDir, tmpBase,
          P.step1[0], P.step1[1]
        );
        if (this.aborted.has(job.id)) throw new Error('Job was cancelled');

        // Step B: Interpolate upscaled→interpolated
        this.emit('log', job.id, '[Pipeline] Interpolating frames (after upscale)...');
        await this.interpolateFrames(
          job.id, outputFramesDir, interpFramesDir, interp!, meta.fps,
          (pct) => {
            const mapped = P.step2[0] + (pct / 100) * (P.step2[1] - P.step2[0]);
            this.emit('progress', job.id, Math.min(P.step2[1], mapped));
          }
        );
        this.emit('log', job.id, '[Pipeline] Interpolation complete');

        finalFramesDir = interpFramesDir;
        finalFps = interp!.targetFps;
      } else {
        // ── No interpolation — just upscale ──
        upscaleInputDir = inputFramesDir;
        upscaleOutputDir = outputFramesDir;

        await this.runUpscalePasses(
          job, engine!, upscaleInputDir, upscaleOutputDir, tmpBase,
          P.step1[0], P.step1[1]
        );

        finalFramesDir = outputFramesDir;
      }

      if (this.aborted.has(job.id)) throw new Error('Job was cancelled');

      // ── Step: Reassemble ──
      this.emit('log', job.id, '[Pipeline] Reassembling video...');
      this.emit('progress', job.id, P.reassemble[0]);

      // Determine frames dir and pattern
      const outFrames = fs.readdirSync(finalFramesDir).filter((f) => f.endsWith('.png'));
      const framesSource = outFrames.length > 0 ? finalFramesDir : inputFramesDir;

      // Detect frame pattern: GMFSS outputs %08d.png, FFmpeg outputs frame_%08d.png
      const firstFrame = outFrames.length > 0 ? outFrames.sort()[0] : '';
      const framePattern = firstFrame.startsWith('frame_')
        ? 'frame_%08d.png'
        : '%08d.png';

      const totalOutputFrames = outFrames.length || meta.frameCount;

      await ffmpegPipeline.reassemble(
        videoPath,
        framesSource,
        outputVideoPath,
        meta.fps,
        meta.hasAudio,
        (frame) => {
          if (totalOutputFrames > 0) {
            const pct = P.reassemble[0] + (frame / totalOutputFrames) * (P.reassemble[1] - P.reassemble[0]);
            this.emit('progress', job.id, Math.min(100, pct));
          }
        },
        hasInterp ? finalFps : undefined,
        framePattern
      );

      this.emit('log', job.id, `[Pipeline] Output: ${outputVideoPath}`);
      this.emit('progress', job.id, 100);
      this.emit('completed', job.id);
    } catch (err: any) {
      if (this.aborted.has(job.id)) {
        this.aborted.delete(job.id);
      }
      this.emit('failed', job.id, err?.message || 'Video pipeline failed');
      throw err;
    } finally {
      try {
        ffmpegPipeline.cleanup(tmpBase);
      } catch {
        // best effort
      }
    }
  }

  /**
   * Helper: run upscale passes on a frames directory.
   * Extracted to share between interpolation pipeline orders.
   */
  private async runUpscalePasses(
    job: Job,
    engine: UpscaleEngine,
    inputDir: string,
    outputDir: string,
    tmpBase: string,
    progressStart: number,
    progressEnd: number
  ): Promise<void> {
    const passes = this.computePasses(job.config.scale, engine.maxNativeScale);
    const totalPasses = passes.length;

    if (totalPasses > 1) {
      this.emit('log', job.id, `[Pipeline] ${job.config.scale}x requires ${totalPasses} passes: ${passes.map(s => s + 'x').join(' → ')}`);
    }

    let currentInputDir = inputDir;
    const progressRange = progressEnd - progressStart;

    for (let passIdx = 0; passIdx < totalPasses; passIdx++) {
      if (this.aborted.has(job.id)) throw new Error('Job was cancelled');

      const passScale = passes[passIdx];
      const isLast = passIdx === totalPasses - 1;

      let currentOutputDir: string;
      if (isLast) {
        currentOutputDir = outputDir;
      } else {
        currentOutputDir = path.join(tmpBase, `frames_pass${passIdx + 1}`);
        fs.mkdirSync(currentOutputDir, { recursive: true });
      }

      const passLabel = totalPasses > 1 ? ` (pass ${passIdx + 1}/${totalPasses}, ${passScale}x)` : '';
      const passProgressStart = progressStart + (passIdx / totalPasses) * progressRange;
      const passProgressRange = progressRange / totalPasses;
      const passConfig = { ...job.config, scale: passScale as any };

      if (!engine.supportsDirectoryInput && engine.buildFileCommand) {
        // ── Per-file processing (e.g. Anime4KCPP) ──
        const frameFiles = fs.readdirSync(currentInputDir)
          .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
          .sort();
        const totalFiles = frameFiles.length;
        this.emit('log', job.id, `[Pipeline] Upscaling ${totalFiles} frames individually${passLabel}`);
        fs.mkdirSync(currentOutputDir, { recursive: true });

        for (let fi = 0; fi < totalFiles; fi++) {
          if (this.aborted.has(job.id)) throw new Error('Job was cancelled');

          const inFile = path.join(currentInputDir, frameFiles[fi]);
          const outFile = path.join(currentOutputDir, frameFiles[fi]);
          const { cmd, args } = engine.buildFileCommand(inFile, outFile, passConfig);

          await this.spawnEngine(job.id, engine, cmd, args, () => {});

          // Update progress per file
          const filePct = passProgressStart + ((fi + 1) / totalFiles) * passProgressRange;
          this.emit('progress', job.id, Math.min(progressEnd, filePct));

          // Log every 100 frames
          if ((fi + 1) % 100 === 0 || fi === totalFiles - 1) {
            this.emit('log', job.id, `[Pipeline] Upscaled ${fi + 1}/${totalFiles} frames${passLabel}`);
          }
        }
      } else {
        // ── Directory-based processing (ncnn-vulkan engines) ──
        const frameJob: Job = {
          ...job,
          inputPaths: [currentInputDir],
          outputDir: currentOutputDir,
          config: passConfig,
        };
        const { cmd, args } = engine.buildCommand(frameJob);
        this.emit('log', job.id, `[Pipeline] Upscaling frames${passLabel}: ${cmd} ${args.join(' ')}`);

        await this.spawnEngine(job.id, engine, cmd, args, (pct) => {
          const mapped = passProgressStart + (pct / 100) * passProgressRange;
          this.emit('progress', job.id, Math.min(progressEnd, mapped));
        });
      }

      if (!isLast) {
        if (currentInputDir !== inputDir) {
          try { fs.rmSync(currentInputDir, { recursive: true, force: true }); } catch { /* best effort */ }
        }
        currentInputDir = currentOutputDir;
      }
    }

    this.emit('log', job.id, '[Pipeline] Frame upscaling complete');
  }

  /**
   * Run a preview crop through the engine.
   */
  async runPreview(
    inputPath: string,
    outputPath: string,
    config: Job['config']
  ): Promise<void> {
    const engine = engineManager.get(config.engine);
    if (!engine) {
      throw new Error(`Engine "${config.engine}" not registered`);
    }

    const { cmd, args } = engine.buildPreviewCommand(inputPath, outputPath, config);

    if (!this.executableExists(cmd)) {
      throw new Error(
        `Engine executable not found: "${cmd}". Set the path in Settings → Engine Executables.`
      );
    }

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(cmd, args, { windowsHide: true });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Preview process exited with code ${code}`));
      });

      proc.on('error', (err) => {
        const msg = err.message.includes('ENOENT')
          ? `Engine executable not found: "${cmd}". Set the path in Settings.`
          : err.message;
        reject(new Error(msg));
      });
    });
  }

  /**
   * Kill a running job process (including interpolation sub-process).
   */
  cancel(jobId: string): boolean {
    this.aborted.add(jobId);
    let killed = false;
    const proc = this.processes.get(jobId);
    if (proc) {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (this.processes.has(jobId)) proc.kill('SIGKILL');
      }, 5000);
      killed = true;
    }
    const interpProc = this.processes.get(`${jobId}_interp`);
    if (interpProc) {
      interpProc.kill('SIGTERM');
      setTimeout(() => {
        if (this.processes.has(`${jobId}_interp`)) interpProc.kill('SIGKILL');
      }, 5000);
      killed = true;
    }
    return killed;
  }

  /**
   * Kill all running processes.
   */
  cancelAll(): void {
    for (const jobId of this.processes.keys()) {
      this.cancel(jobId);
    }
  }

  isRunning(jobId: string): boolean {
    return this.processes.has(jobId);
  }

  /**
   * Check if an executable exists (absolute path or on PATH).
   */
  private executableExists(cmd: string): boolean {
    // If it's an absolute path, check directly
    if (path.isAbsolute(cmd)) {
      return fs.existsSync(cmd);
    }
    // For bare names, check with .exe on Windows
    const ext = process.platform === 'win32' ? '.exe' : '';
    const withExt = ext && !cmd.endsWith(ext) ? cmd + ext : cmd;

    // Check if it exists relative to cwd
    if (fs.existsSync(withExt)) return true;

    // Check PATH
    const envPath = process.env.PATH || process.env.Path || '';
    const dirs = envPath.split(path.delimiter);
    for (const dir of dirs) {
      const full = path.join(dir, withExt);
      if (fs.existsSync(full)) return true;
      if (ext && fs.existsSync(path.join(dir, cmd))) return true;
    }

    return false;
  }
}

export const jobRunner = new JobRunner();
