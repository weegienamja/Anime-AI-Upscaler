# Anime Upscaler – Local Desktop AI Upscaling Dashboard

A local Electron + React desktop application for managing AI image and video upscaling jobs using multiple engines. **No cloud APIs** – all processing runs locally on your GPU.

## Supported Engines

| Engine | Type | Scales | CLI |
|---|---|---|---|
| **Waifu2x** (ncnn-vulkan) | Image | 1x, 2x | `waifu2x-ncnn-vulkan` |
| **Real-ESRGAN** | Image | 2x, 4x | `realesrgan-ncnn-vulkan` |
| **Real-CUGAN** | Image | 1x, 2x, 4x | `realcugan-ncnn-vulkan` |
| **Anime4K** | Image/Video | 2x, 4x | `Anime4KCPP` |
| **SwinIR** | Image | 2x, 4x | Python entrypoint |
| **HAT** | Image | 2x, 4x, 8x | Python entrypoint |

## Quick Start

```bash
cd app
npm install
npm start
```

For development with hot reload:

```bash
npm run dev
```

## Architecture

```
app/src/
├── main/                    # Electron main process
│   ├── index.ts             # App entry, window creation
│   ├── engineManager.ts     # Central engine registry
│   ├── engines/             # Engine adapter implementations
│   │   ├── waifu2x.ts
│   │   ├── realesrgan.ts
│   │   ├── realcugan.ts
│   │   ├── anime4k.ts
│   │   ├── swinir.ts
│   │   └── hat.ts
│   ├── jobRunner.ts         # Spawns CLI processes, streams stdout
│   ├── queueManager.ts      # Job queue with concurrency & OOM retry
│   ├── ffmpegPipeline.ts    # Video frame extraction & reassembly
│   ├── systemInfo.ts        # GPU/CPU/RAM/Disk detection
│   ├── database.ts          # SQLite persistence
│   ├── ipcHandlers.ts       # All IPC channel handlers
│   └── preload.ts           # Context bridge for renderer
├── renderer/                # React UI
│   ├── App.tsx
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── TopBar.tsx
│   │   ├── NewJob.tsx       # Drag-drop files, settings, preview
│   │   ├── QueuePage.tsx    # Live queue with reorder/cancel/retry
│   │   ├── PresetManager.tsx
│   │   ├── PreviewPanel.tsx # Before/after 256x256 crop
│   │   ├── HistoryPage.tsx
│   │   ├── SystemPage.tsx   # GPU/CPU/RAM stats & benchmark
│   │   └── SettingsPage.tsx # Engine paths, ffmpeg, defaults
│   └── styles.css
└── shared/                  # Shared between main & renderer
    ├── types.ts             # All TypeScript interfaces & IPC channels
    └── presets.ts           # Default preset definitions
```

## Features

- **Unified engine abstraction** – drop in new engines without UI changes
- **Job queue** – add, cancel, pause, reorder, retry failed jobs
- **OOM recovery** – automatic retry with reduced tile size on VRAM errors
- **Video workflow** – ffmpeg frame extraction → upscale → reassemble with audio
- **Live stdout streaming** – real-time log output from spawned processes
- **Preview system** – 256×256 crop before/after comparison
- **Preset management** – save/load JSON presets
- **History** – SQLite-backed job history
- **GPU selection** – multi-GPU support via Vulkan detection
- **System monitoring** – GPU, CPU, RAM, disk info

## Configuration

Go to **Settings** page to configure:
1. Path to each engine executable
2. Path to ffmpeg
3. Default output directory
4. Max concurrent jobs
5. Logging and auto-open preferences

## Adding a New Engine

1. Create `src/main/engines/myengine.ts` implementing the `UpscaleEngine` interface
2. Export it from `src/main/engines/index.ts`
3. Register it in `src/main/index.ts` → `initEngines()`
4. Add the engine ID to the `EngineId` type in `src/shared/types.ts`
5. Done — the UI picks it up automatically from the engine list
