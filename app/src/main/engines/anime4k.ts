import {
  UpscaleEngine,
  Job,
  JobConfig,
  ScaleFactor,
  NoiseLevel,
} from '../../shared/types';

/**
 * Anime4K engine adapter
 * Anime4K typically runs as a shader pipeline; this adapter wraps
 * a CLI tool (e.g. Anime4KCPP) that accepts file-based I/O.
 * CLI reference: https://github.com/bloc97/Anime4K
 */
export class Anime4KEngine implements UpscaleEngine {
  id = 'anime4k' as const;
  name = 'Anime4K';
  supportedMedia = ['image' as const, 'video' as const];
  supportedScales: ScaleFactor[] = [2, 4, 8];
  supportedNoises: NoiseLevel[] = [-1, 0, 1, 2, 3];
  maxNativeScale = 4;
  supportsDirectoryInput = false;

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
      '-f', String(c.scale),
    ];
    // Select GPU processor if available
    if (c.gpuId >= 0) {
      args.push('-p', 'cuda', '-d', String(c.gpuId));
    }
    // Select model based on noise level
    const modelMap: Record<number, string> = {
      [-1]: 'acnet-gan',
      0: 'acnet-gan',
      1: 'acnet-hdn0',
      2: 'acnet-hdn1',
      3: 'acnet-hdn2',
    };
    const model = modelMap[c.noise] || 'acnet-gan';
    args.push('-m', model);
    if (c.extraArgs) {
      args.push(...c.extraArgs);
    }
    return { cmd: this.execPath, args };
  }

  buildFileCommand(
    inputFile: string,
    outputFile: string,
    config: JobConfig
  ): { cmd: string; args: string[] } {
    const args: string[] = [
      '-i', inputFile,
      '-o', outputFile,
      '-f', String(config.scale),
    ];
    if (config.gpuId >= 0) {
      args.push('-p', 'cuda', '-d', String(config.gpuId));
    }
    const modelMap: Record<number, string> = {
      [-1]: 'acnet-gan',
      0: 'acnet-gan',
      1: 'acnet-hdn0',
      2: 'acnet-hdn1',
      3: 'acnet-hdn2',
    };
    const model = modelMap[config.noise] || 'acnet-gan';
    args.push('-m', model);
    if (config.extraArgs) {
      args.push(...config.extraArgs);
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
      '-f', String(config.scale),
    ];
    if (config.gpuId >= 0) {
      args.push('-p', 'cuda', '-d', String(config.gpuId));
    }
    return { cmd: this.execPath, args };
  }

  parseProgress(line: string): number | null {
    // Anime4KCPP outputs: "frame xxx/yyy"  or "progress: XX%"
    const pctMatch = line.match(/([\d.]+)%/);
    if (pctMatch) return parseFloat(pctMatch[1]);

    const frameMatch = line.match(/frame\s+(\d+)\s*\/\s*(\d+)/i);
    if (frameMatch) {
      const current = parseInt(frameMatch[1], 10);
      const total = parseInt(frameMatch[2], 10);
      if (total > 0) return (current / total) * 100;
    }
    return null;
  }

  isOomError(line: string): boolean {
    const lower = line.toLowerCase();
    return lower.includes('out of memory') || lower.includes('gpu memory');
  }
}
