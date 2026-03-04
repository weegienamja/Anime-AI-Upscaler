import {
  UpscaleEngine,
  Job,
  JobConfig,
  ScaleFactor,
  NoiseLevel,
} from '../../shared/types';

/**
 * SwinIR engine adapter
 * Uses a Python entrypoint: python main_test_swinir.py ...
 * CLI reference: https://github.com/JingyunLiang/SwinIR
 */
export class SwinIREngine implements UpscaleEngine {
  id = 'swinir' as const;
  name = 'SwinIR';
  supportedMedia = ['image' as const];
  supportedScales: ScaleFactor[] = [2, 4, 8];
  maxNativeScale = 4;
  supportsDirectoryInput = true;
  supportedNoises: NoiseLevel[] = [0];

  private execPath: string; // path to python or the wrapper script

  constructor(execPath: string) {
    this.execPath = execPath;
  }

  setExecPath(p: string) {
    this.execPath = p;
  }

  buildCommand(job: Job): { cmd: string; args: string[] } {
    const c = job.config;
    const args: string[] = [
      '--task', c.model || 'classical_sr',
      '--scale', String(c.scale),
      '--folder_lq', job.inputPaths[0],
      '--save_dir', job.outputDir,
    ];
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
      '--task', config.model || 'classical_sr',
      '--scale', String(config.scale),
      '--folder_lq', inputPath,
      '--save_dir', outputPath,
    ];
    if (config.tileSize > 0) {
      args.push('--tile', String(config.tileSize));
    }
    if (config.gpuId >= 0) {
      args.push('--device', `cuda:${config.gpuId}`);
    }
    return { cmd: this.execPath, args };
  }

  parseProgress(line: string): number | null {
    // SwinIR outputs tqdm-style: " XX%|..." or "Processing X/Y"
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
