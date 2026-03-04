import { Preset, JobConfig } from './types';
import { v4 as uuidv4 } from 'uuid';

function makePreset(
  name: string,
  description: string,
  config: Partial<JobConfig> & Pick<JobConfig, 'engine' | 'noise' | 'scale'>,
  isDefault = false
): Preset {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    name,
    description,
    config: {
      tileSize: 0,
      tta: false,
      threads: 4,
      gpuId: 0,
      deinterlace: 'auto',
      ...config,
    },
    isDefault,
    createdAt: now,
    updatedAt: now,
  };
}

export const DEFAULT_PRESETS: Preset[] = [
  makePreset(
    'Waifu2x – Denoise Medium 2x',
    'Good balance of denoising and upscaling for anime art',
    { engine: 'waifu2x', noise: 2, scale: 2, model: 'models-cunet' },
    true
  ),
  makePreset(
    'Waifu2x – No Denoise 2x',
    'Clean upscale without denoising',
    { engine: 'waifu2x', noise: -1, scale: 2, model: 'models-cunet' }
  ),
  makePreset(
    'Waifu2x – Heavy Denoise 2x',
    'Strong denoising for very noisy sources',
    { engine: 'waifu2x', noise: 3, scale: 2, model: 'models-cunet' }
  ),
  makePreset(
    'Real-ESRGAN – Anime 2x',
    'Real-ESRGAN optimized for anime content',
    { engine: 'realesrgan', noise: 0, scale: 2, model: 'realesrgan-x4plus-anime' }
  ),
  makePreset(
    'Real-ESRGAN – Photo 4x',
    'Real-ESRGAN for photographic content',
    { engine: 'realesrgan', noise: 0, scale: 4, model: 'realesrgan-x4plus' }
  ),
  makePreset(
    'Real-CUGAN – Denoise 2x',
    'Real-CUGAN conservative denoise',
    { engine: 'realcugan', noise: 1, scale: 2, model: 'models-se' }
  ),
  makePreset(
    'Anime4K – Fast 2x',
    'Anime4K fast mode for real-time anime upscaling',
    { engine: 'anime4k', noise: 0, scale: 2 }
  ),
  makePreset(
    'SwinIR – Classical 2x',
    'SwinIR classical image super-resolution',
    { engine: 'swinir', noise: 0, scale: 2, model: 'classical_sr' }
  ),
  makePreset(
    'HAT – Large 4x',
    'HAT high-accuracy transformer model',
    { engine: 'hat', noise: 0, scale: 4, model: 'HAT-L_SRx4' }
  ),
];
