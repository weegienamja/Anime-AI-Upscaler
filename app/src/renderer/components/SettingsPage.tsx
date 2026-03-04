import React, { useState, useEffect, useCallback } from 'react';
import { AppSettings, EngineId } from '../../shared/types';

interface SettingsPageProps {
  settings: AppSettings | null;
  onSave: (settings: AppSettings) => void;
}

const ENGINE_LABELS: Record<EngineId, string> = {
  waifu2x: 'Waifu2x (ncnn-vulkan)',
  realesrgan: 'Real-ESRGAN',
  realcugan: 'Real-CUGAN',
  anime4k: 'Anime4K',
  swinir: 'SwinIR',
  hat: 'HAT',
};

const ENGINE_SOURCES: { name: string; url: string }[] = [
  { name: 'Waifu2x ncnn vulkan', url: 'https://github.com/nihui/waifu2x-ncnn-vulkan' },
  { name: 'Real-ESRGAN', url: 'https://github.com/xinntao/Real-ESRGAN' },
  { name: 'Real-CUGAN', url: 'https://github.com/bzger/realcugan' },
  { name: 'Anime4K', url: 'https://github.com/bloc97/Anime4K' },
  { name: 'ESRGAN', url: 'https://github.com/xinntao/ESRGAN' },
  { name: 'SwinIR', url: 'https://github.com/JingyunLiang/SwinIR' },
  { name: 'HAT', url: 'https://github.com/XPixelGroup/HAT' },
  { name: 'GMFSS_Fortuna', url: 'https://github.com/98mxr/GMFSS_Fortuna' },
  { name: 'GMFSS_union', url: 'https://github.com/98mxr/GMFSS_union' },
];

const SettingsPage: React.FC<SettingsPageProps> = ({ settings, onSave }) => {
  const [local, setLocal] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setLocal({ ...settings });
    }
  }, [settings]);

  const handleSave = useCallback(async () => {
    if (!local) return;
    await window.api.setSettings(local);
    onSave(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [local, onSave]);

  const handleBrowseEngine = useCallback(
    async (engine: EngineId) => {
      const files = await window.api.selectFiles();
      if (files.length > 0 && local) {
        setLocal({
          ...local,
          enginePaths: { ...local.enginePaths, [engine]: files[0] },
        });
      }
    },
    [local]
  );

  const handleBrowseFfmpeg = useCallback(async () => {
    const files = await window.api.selectFiles();
    if (files.length > 0 && local) {
      setLocal({ ...local, ffmpegPath: files[0] });
    }
  }, [local]);

  const handleBrowseOutputDir = useCallback(async () => {
    const dir = await window.api.selectDirectory();
    if (dir && local) {
      setLocal({ ...local, defaultOutputDir: dir });
    }
  }, [local]);

  const handleBrowseTempDir = useCallback(async () => {
    const dir = await window.api.selectDirectory();
    if (dir && local) {
      setLocal({ ...local, tempDir: dir });
    }
  }, [local]);

  const handleBrowsePython = useCallback(async () => {
    const files = await window.api.selectFiles();
    if (files.length > 0 && local) {
      setLocal({ ...local, pythonPath: files[0] });
    }
  }, [local]);

  const handleBrowseGmfss = useCallback(async () => {
    const dir = await window.api.selectDirectory();
    if (dir && local) {
      setLocal({ ...local, gmfssPath: dir });
    }
  }, [local]);

  if (!local) {
    return (
      <div>
        <h1 className="page-title">Settings</h1>
        <div className="empty-state">
          <div className="empty-state__text">Loading settings...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          Settings
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && (
            <span style={{ color: 'var(--success)', fontSize: 13 }}>
              ✓ Saved
            </span>
          )}
          <button className="btn btn--primary" onClick={handleSave}>
            Save Settings
          </button>
        </div>
      </div>

      {/* ─── Engine Paths ──────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section__title">Engine Executables</div>
        {(Object.keys(ENGINE_LABELS) as EngineId[]).map((engine) => (
          <div className="settings-path-row" key={engine}>
            <label>{ENGINE_LABELS[engine]}:</label>
            <input
              className="form-control"
              value={local.enginePaths[engine] || ''}
              onChange={(e) =>
                setLocal({
                  ...local,
                  enginePaths: {
                    ...local.enginePaths,
                    [engine]: e.target.value,
                  },
                })
              }
              placeholder={`Path to ${engine} executable...`}
            />
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => handleBrowseEngine(engine)}
            >
              📂
            </button>
          </div>
        ))}
      </div>

      {/* ─── FFmpeg ────────────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section__title">FFmpeg</div>
        <div className="settings-path-row">
          <label>FFmpeg Path:</label>
          <input
            className="form-control"
            value={local.ffmpegPath || ''}
            onChange={(e) => setLocal({ ...local, ffmpegPath: e.target.value })}
            placeholder="Path to ffmpeg..."
          />
          <button className="btn btn--ghost btn--sm" onClick={handleBrowseFfmpeg}>
            📂
          </button>
        </div>
      </div>

      {/* ─── Python & GMFSS (Frame Interpolation) ─────────────────── */}
      <div className="settings-section">
        <div className="settings-section__title">Frame Interpolation (GMFSS)</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '0 0 8px 0' }}>
          Required for Motion Smoothing (frame interpolation). Install Python 3.8+, PyTorch with CUDA,
          and clone GMFSS_Fortuna from GitHub.
        </p>
        <div className="settings-path-row">
          <label>Python:</label>
          <input
            className="form-control"
            value={local.pythonPath || ''}
            onChange={(e) => setLocal({ ...local, pythonPath: e.target.value })}
            placeholder="python (uses PATH by default)"
          />
          <button className="btn btn--ghost btn--sm" onClick={handleBrowsePython}>
            📂
          </button>
        </div>
        <div className="settings-path-row">
          <label>GMFSS Path:</label>
          <input
            className="form-control"
            value={local.gmfssPath || ''}
            onChange={(e) => setLocal({ ...local, gmfssPath: e.target.value })}
            placeholder="Path to GMFSS_Fortuna folder..."
          />
          <button className="btn btn--ghost btn--sm" onClick={handleBrowseGmfss}>
            📂
          </button>
        </div>
      </div>

      {/* ─── Output ────────────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section__title">Output</div>
        <div className="settings-path-row">
          <label>Default Output:</label>
          <input
            className="form-control"
            value={local.defaultOutputDir || ''}
            onChange={(e) =>
              setLocal({ ...local, defaultOutputDir: e.target.value })
            }
            placeholder="Default output directory..."
            readOnly
          />
          <button
            className="btn btn--ghost btn--sm"
            onClick={handleBrowseOutputDir}
          >
            📂
          </button>
        </div>
      </div>

      {/* ─── Temp Working Directory ────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section__title">Temp Working Directory</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '0 0 8px 0' }}>
          Video processing extracts frames to a temp folder. For 8x upscaling this can use 100+ GB.
          Choose a drive with plenty of free space. Leave empty to auto-select the same drive as the input file.
        </p>
        <div className="settings-path-row">
          <label>Temp Directory:</label>
          <input
            className="form-control"
            value={local.tempDir || ''}
            onChange={(e) =>
              setLocal({ ...local, tempDir: e.target.value })
            }
            placeholder="Auto (same drive as input file)"
            readOnly
          />
          <button
            className="btn btn--ghost btn--sm"
            onClick={handleBrowseTempDir}
          >
            📂
          </button>
          {local.tempDir && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setLocal({ ...local, tempDir: '' })}
              title="Reset to auto"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ─── General ───────────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section__title">General</div>

        <div className="form-row">
          <label>Max Concurrent Jobs:</label>
          <select
            className="form-control"
            value={local.maxConcurrentJobs}
            onChange={(e) =>
              setLocal({
                ...local,
                maxConcurrentJobs: Number(e.target.value),
              })
            }
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <label>Logging:</label>
          <input
            type="checkbox"
            checked={local.loggingEnabled}
            onChange={(e) =>
              setLocal({ ...local, loggingEnabled: e.target.checked })
            }
          />
        </div>

        <div className="form-row">
          <label>Auto Open Result:</label>
          <input
            type="checkbox"
            checked={local.autoOpenResult}
            onChange={(e) =>
              setLocal({ ...local, autoOpenResult: e.target.checked })
            }
          />
        </div>

        <div className="form-row">
          <label>Theme:</label>
          <select
            className="form-control"
            value={local.theme}
            onChange={(e) =>
              setLocal({ ...local, theme: e.target.value as 'light' | 'dark' })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
      </div>

      {/* ─── License Server ──────────────────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section__title">License</div>
        <div className="settings-path-row">
          <label>License Server URL:</label>
          <input
            className="form-control"
            value={local.licenseServerUrl || ''}
            onChange={(e) =>
              setLocal({ ...local, licenseServerUrl: e.target.value })
            }
            placeholder="https://your-domain.com"
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            className="btn btn--primary btn--sm"
            onClick={() => window.api.startLogin()}
          >
            🔗 Open Patreon Login
          </button>
        </div>
      </div>

      {/* ─── Engine Sources (read-only) ──────────────────────────────── */}
      <div className="settings-section">
        <div className="settings-section__title">Engine Sources</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>
          Open-source engines used by this application:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ENGINE_SOURCES.map((src) => (
            <div key={src.url} style={{ fontSize: 13 }}>
              <strong>{src.name}:</strong>{' '}
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--primary)' }}
              >
                {src.url}
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
