import React, { useState, useEffect, useCallback } from 'react';
import { Preset, EngineId } from '../../shared/types';

const PresetManager: React.FC = () => {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [editing, setEditing] = useState<Preset | null>(null);

  useEffect(() => {
    loadPresets();
  }, []);

  const loadPresets = async () => {
    const p = await window.api.listPresets();
    setPresets(p);
  };

  const handleDelete = useCallback(async (id: string) => {
    await window.api.deletePreset(id);
    loadPresets();
  }, []);

  const handleSave = useCallback(async () => {
    if (!editing) return;
    await window.api.savePreset(editing);
    setEditing(null);
    loadPresets();
  }, [editing]);

  const handleCreateNew = useCallback(() => {
    setEditing({
      id: '',
      name: 'New Preset',
      description: '',
      config: {
        engine: 'waifu2x',
        noise: 2,
        scale: 2,
        tileSize: 0,
        tta: false,
        threads: 4,
        gpuId: 0,
        deinterlace: 'auto',
      },
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }, []);

  return (
    <div>
      <h1 className="page-title">Presets</h1>

      <div style={{ marginBottom: 16 }}>
        <button className="btn btn--primary" onClick={handleCreateNew}>
          + New Preset
        </button>
      </div>

      {/* ─── Edit Form ──────────────────────────────────────────────── */}
      {editing && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__title">
            {editing.id ? 'Edit Preset' : 'Create Preset'}
          </div>

          <div className="form-row">
            <label>Name:</label>
            <input
              className="form-control"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </div>

          <div className="form-row">
            <label>Description:</label>
            <input
              className="form-control"
              value={editing.description || ''}
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
            />
          </div>

          <div className="form-row">
            <label>Engine:</label>
            <select
              className="form-control"
              value={editing.config.engine}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  config: { ...editing.config, engine: e.target.value as EngineId },
                })
              }
            >
              <option value="waifu2x">Waifu2x</option>
              <option value="realesrgan">Real-ESRGAN</option>
              <option value="realcugan">Real-CUGAN</option>
              <option value="anime4k">Anime4K</option>
              <option value="swinir">SwinIR</option>
              <option value="hat">HAT</option>
            </select>
          </div>

          <div className="form-row">
            <label>Noise:</label>
            <select
              className="form-control"
              value={editing.config.noise}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  config: { ...editing.config, noise: Number(e.target.value) as any },
                })
              }
            >
              <option value={-1}>None</option>
              <option value={0}>0</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>

          <div className="form-row">
            <label>Scale:</label>
            <select
              className="form-control"
              value={editing.config.scale}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  config: { ...editing.config, scale: Number(e.target.value) as any },
                })
              }
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
              <option value={8}>8x</option>
            </select>
          </div>

          <div className="form-row">
            <label>Default:</label>
            <input
              type="checkbox"
              checked={editing.isDefault || false}
              onChange={(e) =>
                setEditing({ ...editing, isDefault: e.target.checked })
              }
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn--primary" onClick={handleSave}>
              Save
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ─── Preset List ────────────────────────────────────────────── */}
      {presets.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">⚡</div>
          <div className="empty-state__text">No presets yet</div>
        </div>
      ) : (
        <div className="preset-list">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className={`preset-item ${
                preset.isDefault ? 'preset-item--default' : ''
              }`}
            >
              <div className="preset-item__info">
                <div className="preset-item__name">
                  {preset.name}
                  {preset.isDefault && (
                    <span
                      className="status-badge status-badge--running"
                      style={{ marginLeft: 8 }}
                    >
                      DEFAULT
                    </span>
                  )}
                </div>
                {preset.description && (
                  <div className="preset-item__desc">{preset.description}</div>
                )}
                <div className="preset-item__meta">
                  {preset.config.engine} • {preset.config.scale}x •
                  noise {preset.config.noise === -1 ? 'off' : preset.config.noise}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setEditing({ ...preset })}
                >
                  ✏️ Edit
                </button>
                <button
                  className="btn btn--danger btn--sm"
                  onClick={() => handleDelete(preset.id)}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PresetManager;
