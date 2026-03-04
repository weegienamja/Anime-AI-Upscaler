import {
  UpscaleEngine,
  Job,
  JobConfig,
  ScaleFactor,
  NoiseLevel,
} from '../../shared/types';

/**
 * Waifu2x-ncnn-vulkan engine adapter
 * CLI reference: https://github.com/nihui/waifu2x-ncnn-vulkan
 */
export class Waifu2xEngine implements UpscaleEngine {
  id = 'waifu2x' as const;
  name = 'Waifu2x (ncnn-vulkan)';
  supportedMedia = ['image' as const];
  supportedScales: ScaleFactor[] = [1, 2, 4, 8];
  supportedNoises: NoiseLevel[] = [-1, 0, 1, 2, 3];
  maxNativeScale = 2;
  supportsDirectoryInput = true;

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
      '-i', job.inputPaths.length === 1 ? job.inputPaths[0] : job.inputPaths[0],
      '-o', job.outputDir,
      '-n', String(c.noise),
      '-s', String(c.scale),
      '-t', String(c.tileSize || 0),
      '-g', String(c.gpuId),
      '-j', `${c.threads}:${c.threads}:${c.threads}`,
    ];
    if (c.model) {
      args.push('-m', c.model);
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
      '-n', String(config.noise),
      '-s', String(config.scale),
      '-t', String(config.tileSize || 0),
      '-g', String(config.gpuId),
    ];
    if (config.model) {
      args.push('-m', config.model);
    }
    if (config.tta) {
      args.push('-x');
    }
    return { cmd: this.execPath, args };
  }

  parseProgress(line: string): number | null {
    // waifu2x outputs lines like: "X.XX%"  or  "100.00%"
    const m = line.match(/([\d.]+)%/);
    if (m) return parseFloat(m[1]);
    return null;
  }

  isOomError(line: string): boolean {
    const lower = line.toLowerCase();
    return (
      lower.includes('out of memory') ||
      lower.includes('vkAllocateMemory') ||
      lower.includes('failed to allocate') ||
      lower.includes('vk_error_out_of_device_memory')
    );
  }
}
