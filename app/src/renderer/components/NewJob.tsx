import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  EngineId,
  NoiseLevel,
  ScaleFactor,
  JobConfig,
  Preset,
  AppSettings,
  PreviewResult,
  TargetFps,
  PipelineOrder,
  SceneChangeHandling,
  InterpolationQuality,
  InterpolationConfig,
  DeinterlaceMode,
} from '../../shared/types';
import PreviewPanel from './PreviewPanel';

interface NewJobProps {
  selectedGpu: number;
  settings: AppSettings | null;
}

interface EngineStatus {
  id: EngineId;
  name: string;
  description: string;
  installed: boolean;
  installPath: string;
  requiresPython: boolean;
}

interface InstallProgress {
  engineId: EngineId;
  stage: 'downloading' | 'extracting' | 'done' | 'error';
  percent: number;
  message: string;
}

const ENGINES: { id: EngineId; label: string }[] = [
  { id: 'waifu2x', label: 'Waifu2x' },
  { id: 'realesrgan', label: 'Real-ESRGAN' },
  { id: 'realcugan', label: 'Real-CUGAN' },
  { id: 'anime4k', label: 'Anime4K' },
  { id: 'swinir', label: 'SwinIR' },
  { id: 'hat', label: 'HAT' },
];

const NOISE_LEVELS: NoiseLevel[] = [-1, 0, 1, 2, 3];
const SCALE_FACTORS: ScaleFactor[] = [1, 2, 4, 8];
const TILE_SIZES = [0, 32, 64, 128, 200, 400];

function getFileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() || '';
}

function getFileBadge(name: string): { label: string; className: string } {
  const ext = getFileExtension(name);
  const videoExts = ['mp4', 'mkv', 'avi', 'webm', 'mov'];
  if (videoExts.includes(ext)) return { label: 'VID', className: 'file-item__badge--video' };
  if (ext === 'png') return { label: 'PNG', className: 'file-item__badge--png' };
  if (ext === 'jpg' || ext === 'jpeg') return { label: 'JPG', className: 'file-item__badge--jpg' };
  if (ext === 'webp') return { label: 'WEBP', className: 'file-item__badge--webp' };
  return { label: ext.toUpperCase(), className: '' };
}

const NewJob: React.FC<NewJobProps> = ({ selectedGpu, settings }) => {
  const [files, setFiles] = useState<string[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [outputDir, setOutputDir] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [engineStatuses, setEngineStatuses] = useState<EngineStatus[]>([]);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);

  const [config, setConfig] = useState<JobConfig>({
    engine: 'waifu2x',
    noise: 2,
    scale: 2,
    tileSize: 0,
    tta: false,
    threads: 4,
    gpuId: selectedGpu,
    deinterlace: 'auto',
  });

  // ── Interpolation state ──
  const [interpEnabled, setInterpEnabled] = useState(false);
  const [interpTargetFps, setInterpTargetFps] = useState<TargetFps>(60);
  const [interpQuality, setInterpQuality] = useState<InterpolationQuality>('BALANCED');
  const [interpOrder, setInterpOrder] = useState<PipelineOrder>('INTERPOLATE_THEN_UPSCALE');
  const [interpSceneHandling, setInterpSceneHandling] = useState<SceneChangeHandling>('AUTO');

  // Detect if any file is a video
  const videoExts = ['mp4', 'mkv', 'avi', 'webm', 'mov', 'flv', 'wmv', 'ts', 'm4v'];
  const isInterpOnly = interpEnabled && interpOrder === 'INTERPOLATE_ONLY';
  const hasVideoFiles = files.some(
    (f) => videoExts.includes(getFileExtension(f))
  );

  // Load engine install statuses
  useEffect(() => {
    window.api.getEngineStatuses().then((statuses: EngineStatus[]) => {
      setEngineStatuses(statuses);
    });
  }, []);

  // Subscribe to install progress
  useEffect(() => {
    const unsub = window.api.onEngineInstallProgress((progress: InstallProgress) => {
      setInstallProgress(progress);
      if (progress.stage === 'done') {
        // Refresh statuses when install completes
        window.api.getEngineStatuses().then((statuses: EngineStatus[]) => {
          setEngineStatuses(statuses);
        });
        setTimeout(() => setInstallProgress(null), 3000);
      } else if (progress.stage === 'error') {
        setTimeout(() => setInstallProgress(null), 5000);
      }
    });
    return () => { unsub(); };
  }, []);

  const currentEngineStatus = engineStatuses.find((s) => s.id === config.engine);
  const isCurrentEngineInstalled = currentEngineStatus?.installed ?? false;
  const isCurrentEngineInstalling = installProgress?.engineId === config.engine &&
    (installProgress?.stage === 'downloading' || installProgress?.stage === 'extracting');

  const handleInstallEngine = useCallback(async () => {
    try {
      setError(null);
      const statuses = await window.api.installEngine(config.engine);
      setEngineStatuses(statuses);
    } catch (err: any) {
      setError(err?.message || 'Failed to install engine');
    }
  }, [config.engine]);

  // Load presets
  useEffect(() => {
    window.api.listPresets().then((p) => {
      setPresets(p);
      const def = p.find((pr: Preset) => pr.isDefault);
      if (def) {
        setSelectedPreset(def.id);
        setConfig(def.config);
      }
    });
  }, []);

  // Sync GPU
  useEffect(() => {
    setConfig((prev) => ({ ...prev, gpuId: selectedGpu }));
  }, [selectedGpu]);

  // Set default output dir
  useEffect(() => {
    if (settings?.defaultOutputDir && !outputDir) {
      setOutputDir(settings.defaultOutputDir);
    }
  }, [settings]);

  const handleSelectFiles = useCallback(async () => {
    const paths = await window.api.selectFiles();
    if (paths.length > 0) {
      setFiles((prev) => [...new Set([...prev, ...paths])]);
    }
  }, []);

  const handleSelectOutputDir = useCallback(async () => {
    const dir = await window.api.selectDirectory();
    if (dir) setOutputDir(dir);
  }, []);

  const handleRemoveFile = useCallback((filePath: string) => {
    setFiles((prev) => prev.filter((f) => f !== filePath));
  }, []);

  const handlePresetChange = useCallback(
    (presetId: string) => {
      setSelectedPreset(presetId);
      const preset = presets.find((p) => p.id === presetId);
      if (preset) {
        setConfig({ ...preset.config, gpuId: selectedGpu });
      }
    },
    [presets, selectedGpu]
  );

  const updateConfig = useCallback((updates: Partial<JobConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  /** Build the final config including interpolation if enabled for video. */
  const buildFinalConfig = useCallback((): JobConfig => {
    if (!interpEnabled || !hasVideoFiles) return config;
    const interp: InterpolationConfig = {
      enabled: true,
      engine: 'GMFSS',
      inputFps: 'auto',
      targetFps: interpTargetFps,
      multiplier: 0, // computed at job creation time from probed fps
      pipelineOrder: interpOrder,
      sceneChangeHandling: interpSceneHandling,
      quality: interpQuality,
      gpuId: config.gpuId,
    };
    return { ...config, interpolation: interp };
  }, [config, interpEnabled, hasVideoFiles, interpTargetFps, interpOrder, interpSceneHandling, interpQuality]);

  const handleAddToQueue = useCallback(async () => {
    if (files.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const name =
        files.length === 1
          ? files[0].split(/[\\/]/).pop() || 'Job'
          : `Batch (${files.length} files)`;

      const firstExt = getFileExtension(files[0]);
      const mediaType = videoExts.includes(firstExt) ? 'video' : 'image';

      await window.api.createJob({
        name,
        inputPaths: files,
        outputDir: outputDir || files[0].replace(/[\\/][^\\/]+$/, '') || '.',
        mediaType: mediaType as 'image' | 'video',
        config: buildFinalConfig(),
      });

      setFiles([]);
    } catch (err: any) {
      setError(err?.message || 'Failed to add job to queue');
    } finally {
      setSubmitting(false);
    }
  }, [files, outputDir, buildFinalConfig]);

  const handleRunNow = useCallback(async () => {
    if (files.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const name =
        files.length === 1
          ? files[0].split(/[\\/]/).pop() || 'Job'
          : `Batch (${files.length} files)`;

      const firstExt = getFileExtension(files[0]);
      const mediaType = videoExts.includes(firstExt) ? 'video' : 'image';

      await window.api.createJob({
        name,
        inputPaths: files,
        outputDir: outputDir || files[0].replace(/[\\/][^\\/]+$/, '') || '.',
        mediaType: mediaType as 'image' | 'video',
        config: buildFinalConfig(),
        runNow: true,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to run job');
    } finally {
      setSubmitting(false);
    }
  }, [files, outputDir, buildFinalConfig]);

  const handleRunPreview = useCallback(async () => {
    if (files.length === 0) return;
    setPreviewLoading(true);
    try {
      const result = await window.api.runPreview({
        inputPath: files[0],
        config,
        cropRegion: { x: 0, y: 0, width: 256, height: 256 },
      });
      setPreview(result);
    } catch (err) {
      console.error('Preview failed:', err);
    } finally {
      setPreviewLoading(false);
    }
  }, [files, config]);

  // Drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files).map((f) => f.path);
    if (droppedFiles.length > 0) {
      setFiles((prev) => [...new Set([...prev, ...droppedFiles])]);
    }
  }, []);

  return (
    <div>
      <h1 className="page-title">New Job</h1>

      <div className="newjob-layout">
        {/* ─── Input Files ─────────────────────────────────────────── */}
        <div className="card">
          <div className="card__title">Input Files</div>

          <div
            ref={dropRef}
            className={`dropzone ${isDragging ? 'dropzone--active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleSelectFiles}
          >
            <div className="dropzone__icon">📁</div>
            <div className="dropzone__text">
              Drag & Drop Files Here
              <br />
              or click to browse
            </div>
          </div>

          {files.length > 0 && (
            <div className="file-list">
              {files.map((f) => {
                const name = f.split(/[\\/]/).pop() || f;
                const badge = getFileBadge(name);
                return (
                  <div key={f} className="file-item">
                    <span className="file-item__name" title={f}>
                      {name}
                    </span>
                    <span className={`file-item__badge ${badge.className}`}>
                      {badge.label}
                    </span>
                    <button
                      className="file-item__remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFile(f);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="form-row" style={{ marginTop: 12 }}>
            <label>Output Dir:</label>
            <input
              className="form-control"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="Select output directory..."
              readOnly
            />
            <button className="btn btn--ghost btn--sm" onClick={handleSelectOutputDir}>
              📂
            </button>
          </div>
        </div>

        {/* ─── Upscale Settings ────────────────────────────────────── */}
        <div className="card" style={isInterpOnly ? { opacity: 0.35, pointerEvents: 'none', position: 'relative' } : undefined}>
          <div className="card__title">
            Upscale Settings
            {isInterpOnly && (
              <span style={{ fontSize: 11, fontWeight: 400, color: '#4caf50', marginLeft: 8 }}>
                — Skipped (Interpolate Only)
              </span>
            )}
          </div>

          <div className="form-row">
            <label>Preset:</label>
            <select
              className="form-control"
              value={selectedPreset}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              <option value="">Custom</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Engine:</label>
            <select
              className="form-control"
              value={config.engine}
              onChange={(e) => updateConfig({ engine: e.target.value as EngineId })}
            >
              {ENGINES.map((eng) => {
                const status = engineStatuses.find((s) => s.id === eng.id);
                const badge = status?.installed ? ' ✓' : status?.requiresPython ? ' (Python)' : '';
                return (
                  <option key={eng.id} value={eng.id}>
                    {eng.label}{badge}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Engine install status */}
          {currentEngineStatus && !isCurrentEngineInstalled && !isCurrentEngineInstalling && (
            <div style={{
              background: 'rgba(255,193,7,0.1)',
              border: '1px solid rgba(255,193,7,0.3)',
              borderRadius: 6,
              padding: '10px 14px',
              marginBottom: 12,
              fontSize: 13,
            }}>
              <div style={{ marginBottom: 6, color: '#ffc107' }}>
                ⚠ {currentEngineStatus.name} is not installed
              </div>
              <div style={{ color: 'var(--text-secondary)', marginBottom: 8, fontSize: 12 }}>
                {currentEngineStatus.description}
              </div>
              {currentEngineStatus.requiresPython ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                  Requires Python + PyTorch. Install manually.
                </div>
              ) : (
                <button
                  className="btn btn--primary btn--sm"
                  onClick={handleInstallEngine}
                  style={{ fontSize: 13 }}
                >
                  ⬇ Install {currentEngineStatus.name}
                </button>
              )}
            </div>
          )}

          {/* Install progress */}
          {isCurrentEngineInstalling && installProgress && (
            <div style={{
              background: 'rgba(99,179,237,0.1)',
              border: '1px solid rgba(99,179,237,0.3)',
              borderRadius: 6,
              padding: '10px 14px',
              marginBottom: 12,
              fontSize: 13,
            }}>
              <div style={{ marginBottom: 6, color: '#63b3ed' }}>
                {installProgress.message}
              </div>
              <div style={{
                height: 6,
                borderRadius: 3,
                background: 'rgba(255,255,255,0.1)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, installProgress.percent)}%`,
                  background: 'linear-gradient(90deg, #63b3ed, #4299e1)',
                  borderRadius: 3,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          )}

          {/* Install success */}
          {installProgress?.engineId === config.engine && installProgress?.stage === 'done' && (
            <div style={{
              background: 'rgba(72,187,120,0.1)',
              border: '1px solid rgba(72,187,120,0.3)',
              borderRadius: 6,
              padding: '10px 14px',
              marginBottom: 12,
              fontSize: 13,
              color: '#48bb78',
            }}>
              ✓ {installProgress.message}
            </div>
          )}

          {/* Install error */}
          {installProgress?.engineId === config.engine && installProgress?.stage === 'error' && (
            <div style={{
              background: 'rgba(255,107,107,0.1)',
              border: '1px solid rgba(255,107,107,0.3)',
              borderRadius: 6,
              padding: '10px 14px',
              marginBottom: 12,
              fontSize: 13,
              color: '#ff6b6b',
            }}>
              ✕ {installProgress.message}
            </div>
          )}

          <div className="form-row">
            <label>Noise:</label>
            <select
              className="form-control"
              value={config.noise}
              onChange={(e) =>
                updateConfig({ noise: Number(e.target.value) as NoiseLevel })
              }
            >
              {NOISE_LEVELS.map((n) => (
                <option key={n} value={n}>
                  {n === -1 ? 'None' : `Level ${n}`}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Scale:</label>
            <select
              className="form-control"
              value={config.scale}
              onChange={(e) =>
                updateConfig({ scale: Number(e.target.value) as ScaleFactor })
              }
            >
              {SCALE_FACTORS.map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Tile Size:</label>
            <select
              className="form-control"
              value={config.tileSize}
              onChange={(e) => updateConfig({ tileSize: Number(e.target.value) })}
            >
              {TILE_SIZES.map((t) => (
                <option key={t} value={t}>
                  {t === 0 ? 'Auto' : t}
                </option>
              ))}
            </select>
          </div>

          {hasVideoFiles && (
            <div className="form-row">
              <label title="AUTO: automatically detects and fixes interlaced video (recommended). ON: always deinterlace. OFF: never deinterlace.">
                Deinterlace:
              </label>
              <select
                className="form-control"
                value={config.deinterlace}
                onChange={(e) => updateConfig({ deinterlace: e.target.value as DeinterlaceMode })}
              >
                <option value="auto">Auto (Recommended)</option>
                <option value="on">Always On</option>
                <option value="off">Off</option>
              </select>
            </div>
          )}

          <button
            className="btn btn--ghost btn--sm"
            style={{ marginBottom: 8 }}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? '▼ Hide Advanced' : '▶ Show Advanced'}
          </button>

          {showAdvanced && (
            <>
              <div className="form-row">
                <label>TTA:</label>
                <select
                  className="form-control"
                  value={config.tta ? 'on' : 'off'}
                  onChange={(e) => updateConfig({ tta: e.target.value === 'on' })}
                >
                  <option value="off">Off</option>
                  <option value="on">On</option>
                </select>
              </div>

              <div className="form-row">
                <label>Threads:</label>
                <select
                  className="form-control"
                  value={config.threads}
                  onChange={(e) => updateConfig({ threads: Number(e.target.value) })}
                >
                  {[1, 2, 4, 8, 12, 16].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <label>Model:</label>
                <input
                  className="form-control"
                  value={config.model || ''}
                  onChange={(e) => updateConfig({ model: e.target.value || undefined })}
                  placeholder="Default"
                />
              </div>
            </>
          )}

          {error && (
            <div style={{ color: '#ff6b6b', background: 'rgba(255,107,107,0.1)', padding: '8px 12px', borderRadius: 6, marginTop: 8, fontSize: 13 }}>
              ⚠ {error}
            </div>
          )}

        </div>

        {/* ─── Action Buttons (always accessible) ─────────────────── */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn--primary"
            onClick={handleAddToQueue}
            disabled={files.length === 0 || submitting || (!isInterpOnly && !isCurrentEngineInstalled)}
            title={!isInterpOnly && !isCurrentEngineInstalled ? 'Install the engine first' : undefined}
          >
            Add to Queue
          </button>
          <button
            className="btn btn--success btn--lg"
            onClick={handleRunNow}
            disabled={files.length === 0 || submitting || (!isInterpOnly && !isCurrentEngineInstalled)}
            title={!isInterpOnly && !isCurrentEngineInstalled ? 'Install the engine first' : undefined}
          >
            {submitting ? 'Starting...' : 'Run Now'}
          </button>
        </div>

        {/* ─── Motion Smoothing (Frame Interpolation) ─────────────────── */}
        <div className="card">
            <div className="card__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Motion Smoothing
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400 }}>
                (Frame Interpolation)
              </span>
            </div>

            <div className="form-row" style={{ alignItems: 'center' }}>
              <label>Enable:</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={interpEnabled}
                  onChange={(e) => setInterpEnabled(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <span style={{ fontSize: 13 }}>
                  {interpEnabled ? 'On' : 'Off'}
                </span>
              </label>
            </div>

            {interpEnabled && (
              <>
                <div style={{
                  background: 'rgba(99,179,237,0.08)',
                  border: '1px solid rgba(99,179,237,0.2)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  marginBottom: 12,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}>
                  Uses GMFSS_Fortuna to generate intermediate frames for smoother motion.
                  Requires Python + PyTorch + GMFSS_Fortuna installed.
                </div>

                <div className="form-row">
                  <label>Target FPS:</label>
                  <select
                    className="form-control"
                    value={interpTargetFps}
                    onChange={(e) => setInterpTargetFps(Number(e.target.value) as TargetFps)}
                  >
                    <option value={48}>48 fps</option>
                    <option value={60}>60 fps</option>
                    <option value={120}>120 fps</option>
                  </select>
                </div>

                <div className="form-row">
                  <label title="FAST = lower quality, less VRAM. BALANCED = recommended. BEST = ensemble mode, slower but highest quality.">
                    Quality:
                  </label>
                  <select
                    className="form-control"
                    value={interpQuality}
                    onChange={(e) => setInterpQuality(e.target.value as InterpolationQuality)}
                  >
                    <option value="FAST">Fast</option>
                    <option value="BALANCED">Balanced</option>
                    <option value="BEST">Best (Ensemble)</option>
                  </select>
                </div>

                <div className="form-row">
                  <label title="INTERPOLATE_THEN_UPSCALE processes more frames at original resolution (faster, less VRAM). UPSCALE_THEN_INTERPOLATE interpolates at higher resolution (better quality, more VRAM).">
                    Pipeline Order:
                  </label>
                  <select
                    className="form-control"
                    value={interpOrder}
                    onChange={(e) => setInterpOrder(e.target.value as PipelineOrder)}
                  >
                    <option value="INTERPOLATE_ONLY">Interpolate Only (no upscale)</option>
                    <option value="INTERPOLATE_THEN_UPSCALE">Interpolate → Upscale</option>
                    <option value="UPSCALE_THEN_INTERPOLATE">Upscale → Interpolate</option>
                  </select>
                </div>

                <div className="form-row">
                  <label title="AUTO detects scene changes automatically. STRICT uses a lower threshold (catches more). OFF disables detection (may blend across cuts).">
                    Scene Detection:
                  </label>
                  <select
                    className="form-control"
                    value={interpSceneHandling}
                    onChange={(e) => setInterpSceneHandling(e.target.value as SceneChangeHandling)}
                  >
                    <option value="AUTO">Auto</option>
                    <option value="STRICT">Strict</option>
                    <option value="OFF">Off</option>
                  </select>
                </div>

                {interpOrder === 'INTERPOLATE_ONLY' && (
                  <div style={{
                    background: 'rgba(76,175,80,0.08)',
                    border: '1px solid rgba(76,175,80,0.2)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginTop: 4,
                    fontSize: 12,
                    color: '#4caf50',
                  }}>
                    ✓ Interpolation only — no upscaling will be performed.
                    Ideal for videos that are already upscaled or at the desired resolution.
                  </div>
                )}

                {interpOrder === 'UPSCALE_THEN_INTERPOLATE' && (
                  <div style={{
                    background: 'rgba(255,193,7,0.08)',
                    border: '1px solid rgba(255,193,7,0.2)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginTop: 4,
                    fontSize: 12,
                    color: '#ffc107',
                  }}>
                    ⚠ Upscale → Interpolate uses significantly more VRAM and disk space,
                    since interpolation runs on upscaled frames.
                  </div>
                )}

                {interpTargetFps === 120 && (
                  <div style={{
                    background: 'rgba(255,193,7,0.08)',
                    border: '1px solid rgba(255,193,7,0.2)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginTop: 4,
                    fontSize: 12,
                    color: '#ffc107',
                  }}>
                    ⚠ 120fps output will produce ~5x more frames, requiring much more
                    disk space and processing time.
                  </div>
                )}
              </>
            )}
          </div>

        {/* ─── Preview ─────────────────────────────────────────────── */}
        <div className="card">
          <div className="card__title">Preview</div>
          <PreviewPanel
            preview={preview}
            loading={previewLoading}
            onRunPreview={handleRunPreview}
            hasFiles={files.length > 0}
          />
        </div>
      </div>
    </div>
  );
};

export default NewJob;
