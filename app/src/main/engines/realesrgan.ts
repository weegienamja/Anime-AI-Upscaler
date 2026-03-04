import {
  UpscaleEngine,
  Job,
  JobConfig,
  ScaleFactor,
  NoiseLevel,
} from '../../shared/types';

/**
 * Real-ESRGAN engine adapter
 * Supports realesrgan-ncnn-vulkan CLI
 * CLI reference: https://github.com/xinntao/Real-ESRGAN
 */
export class RealESRGANEngine implements UpscaleEngine {
  id = 'realesrgan' as const;
  name = 'Real-ESRGAN';
  supportedMedia = ['image' as const];
  supportedScales: ScaleFactor[] = [2, 4, 8];
  supportedNoises: NoiseLevel[] = [0];
  supportsDirectoryInput = true;
  maxNativeScale = 4;

  private execPath: string;

  constructor(execPath: string) {
    this.execPath = execPath;
  }

  setExecPath(p: string) {
    this.execPath = p;
  }

  buildCommand(job: Job): { cmd: string; args: string[] } {
    const c = job.config;
    const args: string[] = [
      '-i', job.inputPaths[0],
      '-o', job.outputDir,
      '-s', String(c.scale),
      '-t', String(c.tileSize || 0),
      '-g', String(c.gpuId),
      '-j', `${c.threads}:${c.threads}:${c.threads}`,
    ];
    if (c.model) {
      args.push('-n', c.model);
    }
    if (c.tta) {
      args.push('-x');
    }
    if (c.extraArgs) {
      args.push(...c.extraArgs);
    }
    return { cmd: this.execPath, args };
  }

  buildPreviewCommand(
    inputPath: string,
    outputPath: string,
    config: JobConfig
  ): { cmd: string; args: string[] } {
    const args: string[] = [
      '-i', inputPath,
      '-o', outputPath,
      '-s', String(config.scale),
      '-t', String(config.tileSize || 0),
      '-g', String(config.gpuId),
    ];
    if (config.model) {
      args.push('-n', config.model);
    }
    if (config.tta) {
      args.push('-x');
    }
    return { cmd: this.execPath, args };
  }

  parseProgress(line: string): number | null {
    const m = line.match(/([\d.]+)%/);
    if (m) return parseFloat(m[1]);
    return null;
  }

  isOomError(line: string): boolean {
    const lower = line.toLowerCase();
    return (
      lower.includes('out of memory') ||
      lower.includes('vkAllocateMemory') ||
      lower.includes('vk_error_out_of_device_memory')
    );
  }
}
