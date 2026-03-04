import {
  UpscaleEngine,
  Job,
  JobConfig,
  ScaleFactor,
  NoiseLevel,
} from '../../shared/types';

/**
 * HAT engine adapter
 * Uses a Python entrypoint
 * CLI reference: https://github.com/XPixelGroup/HAT
 */
export class HATEngine implements UpscaleEngine {
  id = 'hat' as const;
  name = 'HAT';
  supportedMedia = ['image' as const];
  supportedScales: ScaleFactor[] = [2, 4, 8];
  maxNativeScale = 8;
  supportsDirectoryInput = true;
  supportedNoises: NoiseLevel[] = [0];

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
      '--input', job.inputPaths[0],
      '--output', job.outputDir,
      '--scale', String(c.scale),
    ];
    if (c.model) {
      args.push('--model_path', c.model);
    }
    if (c.tileSize > 0) {
      args.push('--tile', String(c.tileSize));
    }
    if (c.gpuId >= 0) {
      args.push('--device', `cuda:${c.gpuId}`);
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
      '--input', inputPath,
      '--output', outputPath,
      '--scale', String(config.scale),
    ];
    if (config.model) {
      args.push('--model_path', config.model);
    }
    if (config.tileSize > 0) {
      args.push('--tile', String(config.tileSize));
    }
    if (config.gpuId >= 0) {
      args.push('--device', `cuda:${config.gpuId}`);
    }
    return { cmd: this.execPath, args };
  }

  parseProgress(line: string): number | null {
    const pctMatch = line.match(/([\d.]+)%/);
    if (pctMatch) return parseFloat(pctMatch[1]);

    const fracMatch = line.match(/(\d+)\s*\/\s*(\d+)/);
    if (fracMatch) {
      const cur = parseInt(fracMatch[1], 10);
      const tot = parseInt(fracMatch[2], 10);
      if (tot > 0) return (cur / tot) * 100;
    }
    return null;
  }

  isOomError(line: string): boolean {
    const lower = line.toLowerCase();
    return (
      lower.includes('cuda out of memory') ||
      lower.includes('out of memory') ||
      lower.includes('oom')
    );
  }
}
