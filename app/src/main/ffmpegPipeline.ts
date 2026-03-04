import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { VideoMeta, DeinterlaceMode } from '../shared/types';

/**
 * FFmpeg pipeline for video upscaling workflow:
 * 1. Extract frames
 * 2. (Frames processed by engine externally)
 * 3. Reassemble video with audio
 */
export class FFmpegPipeline {
  private ffmpegPath: string;
  private ffprobePath: string;

  constructor(ffmpegPath: string) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  }

  setPath(p: string) {
    this.ffmpegPath = p;
    this.ffprobePath = p.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  }

  getFfmpegPath(): string {
    return this.ffmpegPath;
  }

  getFfprobePath(): string {
    return this.ffprobePath;
  }

  /**
   * Probe a video file for metadata.
   */
  async probe(videoPath: string): Promise<VideoMeta> {
    return new Promise((resolve, reject) => {
      execFile(
        this.ffprobePath,
        [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_format',
          '-show_streams',
          videoPath,
        ],
        { windowsHide: true },
        (err, stdout) => {
          if (err) return reject(err);
          try {
            const data = JSON.parse(stdout);
            const videoStream = data.streams?.find(
              (s: any) => s.codec_type === 'video'
            );
            const audioStream = data.streams?.find(
              (s: any) => s.codec_type === 'audio'
            );

            if (!videoStream) {
              return reject(new Error('No video stream found'));
            }

            const [fpsNum, fpsDen] = (videoStream.r_frame_rate || '30/1')
              .split('/')
              .map(Number);
            const fps = fpsDen ? fpsNum / fpsDen : 30;
            const duration = parseFloat(data.format?.duration || '0');
            const frameCount = parseInt(videoStream.nb_frames || '0', 10) ||
              Math.ceil(fps * duration);

            // Detect interlacing from field_order
            const fieldOrder: string = (videoStream.field_order || 'unknown').toLowerCase();
            const isInterlaced = ['tt', 'bb', 'tb', 'bt'].includes(fieldOrder);

            resolve({
              width: videoStream.width || 0,
              height: videoStream.height || 0,
              fps,
              frameCount,
              duration,
              hasAudio: !!audioStream,
              codec: videoStream.codec_name || 'unknown',
              isInterlaced,
              fieldOrder: fieldOrder === 'unknown' ? 'progressive' : fieldOrder,
            });
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }

  /**
   * Extract all frames from a video as PNG images.
   * Returns the directory containing the frames.
   */
  async extractFrames(
    videoPath: string,
    framesDir: string,
    onProgress?: (frame: number, total: number) => void,
    deinterlace: DeinterlaceMode = 'auto'
  ): Promise<string> {
    fs.mkdirSync(framesDir, { recursive: true });

    const meta = await this.probe(videoPath);

    // Determine if we should deinterlace
    const shouldDeinterlace =
      deinterlace === 'on' ||
      (deinterlace === 'auto' && meta.isInterlaced);

    const args: string[] = ['-i', videoPath];

    if (shouldDeinterlace) {
      // bwdif is a high-quality deinterlacing filter:
      //   mode=0 = output one frame per frame (not field-rate doubling)
      //   parity=-1 = auto-detect field parity
      //   deint=0 = deinterlace all frames (safe even if some are progressive)
      args.push('-vf', 'bwdif=mode=0:parity=-1:deint=0');
    }

    // -vsync cfr ensures constant frame rate output (handles VFR sources)
    // PNG is lossless; no quality flags needed
    args.push(
      '-vsync', 'cfr',
      '-pix_fmt', 'rgb24',
      path.join(framesDir, 'frame_%08d.png')
    );

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args, { windowsHide: true });

      let frameCount = 0;

      proc.stderr?.on('data', (data: Buffer) => {
        const line = data.toString();
        const m = line.match(/frame=\s*(\d+)/);
        if (m) {
          frameCount = parseInt(m[1], 10);
          onProgress?.(frameCount, meta.frameCount);
        }
      });

      proc.on('close', (code) => {
        if (code === 0) resolve(framesDir);
        else reject(new Error(`ffmpeg frame extraction exited with code ${code}`));
      });

      proc.on('error', reject);
    });
  }

  /**
   * Reassemble upscaled frames back into a video, preserving audio from the original.
   * @param outputFps - If provided, overrides fps for the output (e.g. after interpolation).
   * @param framePattern - Glob pattern for frames (default: 'frame_%08d.png').
   */
  async reassemble(
    originalVideoPath: string,
    framesDir: string,
    outputPath: string,
    fps: number,
    hasAudio: boolean,
    onProgress?: (frame: number, total: number) => void,
    outputFps?: number,
    framePattern?: string
  ): Promise<void> {
    const pattern = framePattern || 'frame_%08d.png';
    const inputFpsStr = String(outputFps || fps);
    const args: string[] = [
      '-framerate', inputFpsStr,
      '-i', path.join(framesDir, pattern),
    ];

    if (hasAudio) {
      args.push('-i', originalVideoPath);
      args.push('-map', '0:v', '-map', '1:a');
    }

    args.push(
      '-c:v', 'libx264',
      '-crf', '18',
      // Pad to even dimensions (required by yuv420p) — avoids green/black line artifacts
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-pix_fmt', 'yuv420p',
      '-preset', 'slow',
    );

    if (hasAudio) {
      // When fps changed, re-encode audio and use -shortest to keep A/V in sync
      if (outputFps && outputFps !== fps) {
        args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
      } else {
        args.push('-c:a', 'copy');
      }
    }

    args.push('-y', outputPath);

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args, { windowsHide: true });

      proc.stderr?.on('data', (data: Buffer) => {
        const line = data.toString();
        const m = line.match(/frame=\s*(\d+)/);
        if (m && onProgress) {
          onProgress(parseInt(m[1], 10), 0);
        }
      });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg reassembly exited with code ${code}`));
      });

      proc.on('error', reject);
    });
  }

  /**
   * Crop a region from an image using ffmpeg.
   * Used for generating preview crops.
   */
  async cropImage(
    inputPath: string,
    outputPath: string,
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        this.ffmpegPath,
        [
          '-i', inputPath,
          '-vf', `crop=${width}:${height}:${x}:${y}`,
          '-y', outputPath,
        ],
        { windowsHide: true },
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Clean up temporary frame directories.
   */
  cleanup(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
}

export const ffmpegPipeline = new FFmpegPipeline('ffmpeg');
