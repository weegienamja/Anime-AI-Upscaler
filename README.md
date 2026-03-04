# Anime AI Upscaler

A local desktop application for AI-powered anime upscaling and frame interpolation. Built with Electron + React + TypeScript. **All processing runs locally on your GPU** — no cloud APIs, no uploads, no subscriptions.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### Multi-Engine Upscaling

| Engine | Backend | Best For | Scales |
|---|---|---|---|
| **Waifu2x** | ncnn-vulkan | Anime art, general denoising | 1×, 2×, 4×, 8× |
| **Real-ESRGAN** | ncnn-vulkan | Photographic & anime content | 2×, 4×, 8× |
| **Real-CUGAN** | ncnn-vulkan | Anime with fine detail preservation | 1×, 2×, 4×, 8× |
| **Anime4K** | Anime4KCPP | Fast anime upscaling | 2×, 4×, 8× |
| **SwinIR** | PyTorch | High-quality restoration | 2×, 4× |
| **HAT** | PyTorch | State-of-the-art super-resolution | 2×, 4×, 8× |

> Scales above 2× are achieved automatically via multi-pass processing (sequential 2× passes).

### Frame Interpolation (Motion Smoothing)

- **GMFSS_Fortuna** AI-powered frame interpolation
- Boost video from 24fps → 48/60/120fps with smooth intermediate frames
- Timestamp-based frame placement for accurate non-integer multipliers (e.g. 24→60fps)
- Three quality modes: Fast, Balanced, Best (Ensemble)
- Scene change detection (Auto/Strict/Off) to prevent blending across cuts
- Three pipeline orders:
  - **Interpolate Only** — frame interpolation without any upscaling
  - **Interpolate → Upscale** — interpolate at original resolution, then upscale (faster, less VRAM)
  - **Upscale → Interpolate** — upscale first, then interpolate at high resolution (best quality)

### Video Pipeline

- Full video workflow: **probe → extract → process → reassemble**
- Automatic **deinterlacing** (bwdif filter) for interlaced anime sources (DVD/broadcast)
- Audio preservation with automatic re-encoding when FPS changes
- Smart temp directory selection with disk space pre-check
- Progress tracking through every pipeline stage

### Desktop Application

- Drag-and-drop file input (images and videos)
- Real-time job queue with progress, cancel, and retry
- Before/after preview comparison (256×256 crop)
- Preset management (save/load processing configurations)
- Engine auto-installer (downloads binaries from GitHub releases)
- Multi-GPU support with Vulkan device selection
- Job history with SQLite persistence
- System monitoring (GPU, CPU, RAM, disk)
- OOM recovery — automatic retry with reduced tile size on VRAM errors

---

## Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **FFmpeg** (for video processing) — install via `winget install ffmpeg` or download from [ffmpeg.org](https://ffmpeg.org/)
- **GPU** with Vulkan support (NVIDIA, AMD, or Intel)

### Install & Run

```bash
cd app
npm install
npm run build
npx electron .
```

### For Development (with hot reload)

```bash
cd app
npm run dev
```

### Engine Setup

On first launch, the app detects available engines in the `bin/` directory. Missing engines can be installed directly from the Settings page using the built-in installer.

**Bundled engine locations:**

```
bin/
├── waifu2x-ncnn-vulkan-*/          # Waifu2x
├── realesrgan-ncnn-vulkan-*/        # Real-ESRGAN
├── realcugan-ncnn-vulkan-*/         # Real-CUGAN
└── Anime4KCPP/                      # Anime4K
```

### Frame Interpolation Setup (Optional)

Frame interpolation requires a separate Python environment:

1. Install **Python 3.11** (3.12+ may have PyTorch compatibility issues)
2. Install PyTorch with CUDA:
   ```bash
   pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cu121
   ```
3. Clone [GMFSS_Fortuna](https://github.com/98mxr/GMFSS_Fortuna) and download model weights
4. Set the Python path and GMFSS directory in **Settings → Frame Interpolation**

---

## Architecture

```
app/
├── src/
│   ├── main/                        # Electron main process
│   │   ├── index.ts                 # Window creation, app lifecycle
│   │   ├── engineManager.ts         # Engine registry & detection
│   │   ├── engineInstaller.ts       # GitHub release downloader
│   │   ├── engines/                 # Engine adapters
│   │   │   ├── waifu2x.ts
│   │   │   ├── realesrgan.ts
│   │   │   ├── realcugan.ts
│   │   │   ├── anime4k.ts
│   │   │   ├── swinir.ts
│   │   │   └── hat.ts
│   │   ├── jobRunner.ts             # Pipeline orchestration
│   │   ├── queueManager.ts          # Job queue with concurrency
│   │   ├── ffmpegPipeline.ts        # Video probe/extract/reassemble
│   │   ├── database.ts              # SQLite settings & history
│   │   ├── ipcHandlers.ts           # IPC bridge to renderer
│   │   ├── systemInfo.ts            # GPU/CPU/RAM detection
│   │   └── licenseClient.ts         # Patreon license auth
│   ├── renderer/                    # React UI
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── NewJob.tsx           # File input, engine config, interpolation
│   │   │   ├── QueuePage.tsx        # Live queue with reorder/cancel
│   │   │   ├── PreviewPanel.tsx     # Before/after comparison
│   │   │   ├── PresetManager.tsx    # Save/load presets
│   │   │   ├── HistoryPage.tsx      # Job history
│   │   │   ├── SettingsPage.tsx     # Paths, defaults, interpolation config
│   │   │   └── SystemPage.tsx       # Hardware info
│   │   └── styles.css
│   └── shared/                      # Shared types & presets
│       ├── types.ts
│       └── presets.ts
├── tools/
│   └── gmfss/
│       └── run_gmfss.py             # GMFSS_Fortuna Python wrapper
└── package.json

license-server/                      # Patreon license server (Express + SQLite)
└── src/
```

---

## Adding a New Engine

1. Create `app/src/main/engines/myengine.ts` implementing the `UpscaleEngine` interface
2. Export it from `app/src/main/engines/index.ts`
3. Register it in `app/src/main/index.ts` → `initEngines()`
4. Add the engine ID to the `EngineId` type in `app/src/shared/types.ts`
5. The UI picks it up automatically

---

## Configuration

All settings are managed through the **Settings** page:

| Setting | Description |
|---|---|
| Engine Paths | Auto-detected from `bin/`, or set manually |
| FFmpeg Path | Path to ffmpeg executable |
| Output Directory | Default output location |
| Temp Directory | Working directory for frame extraction (needs free space) |
| GPU Selection | Choose which Vulkan GPU to use |
| Python Path | Python 3.11 executable for frame interpolation |
| GMFSS Path | Path to GMFSS_Fortuna repository |

---

## Video Processing Notes

- **Deinterlacing**: Set to **Auto** (default) to automatically detect and deinterlace interlaced sources. Use **Always On** for sources where auto-detection fails.
- **Disk Space**: Video processing extracts all frames as PNG. A 24fps, 10-minute video at 1080p needs ~30–50 GB of temp space. Use the Settings page to point the temp directory to a drive with enough room.
- **Multi-pass Upscaling**: Scales above 2× run multiple sequential passes (e.g. 8× = three 2× passes). Each pass doubles the resolution.

---

## Tech Stack

- **Electron 28** — cross-platform desktop shell
- **React 18** — UI framework
- **TypeScript 5.3** — type safety across main and renderer
- **Webpack 5** — renderer bundling
- **better-sqlite3** — fast embedded database
- **ncnn + Vulkan** — GPU-accelerated neural network inference
- **FFmpeg** — video processing pipeline
- **GMFSS_Fortuna + PyTorch** — AI frame interpolation

---

## Credits

- [waifu2x-ncnn-vulkan](https://github.com/nihui/waifu2x-ncnn-vulkan) by nihui
- [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) by xinntao
- [Real-CUGAN](https://github.com/bilibili/ailab/tree/main/Real-CUGAN) by bilibili
- [Anime4KCPP](https://github.com/TianZerL/Anime4KCPP) by TianZerL
- [GMFSS_Fortuna](https://github.com/98mxr/GMFSS_Fortuna) by 98mxr
- [ncnn](https://github.com/Tencent/ncnn) by Tencent
- [FFmpeg](https://ffmpeg.org/)

## License

MIT
