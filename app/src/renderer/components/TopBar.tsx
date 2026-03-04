import React from 'react';
import { GpuInfo } from '../../shared/types';

interface TopBarProps {
  gpus: GpuInfo[];
  selectedGpu: number;
  onGpuChange: (gpuId: number) => void;
  isPaused: boolean;
  onTogglePause: () => void;
  onStopAll: () => void;
  onOpenOutput: () => void;
}

const TopBar: React.FC<TopBarProps> = ({
  gpus,
  selectedGpu,
  onGpuChange,
  isPaused,
  onTogglePause,
  onStopAll,
  onOpenOutput,
}) => {
  return (
    <header className="topbar">
      <span className="topbar__title">Anime Upscaler</span>

      <div className="topbar__gpu">
        <span>GPU:</span>
        <select
          value={selectedGpu}
          onChange={(e) => onGpuChange(Number(e.target.value))}
        >
          {gpus.map((gpu) => (
            <option key={gpu.id} value={gpu.id}>
              {gpu.name} ({gpu.vendor})
            </option>
          ))}
          {gpus.length === 0 && <option value={0}>Detecting...</option>}
        </select>
      </div>

      <button className="btn btn--ghost btn--sm" onClick={onTogglePause}>
        {isPaused ? '▶ Resume Queue' : '⏸ Pause Queue'}
      </button>

      <button className="btn btn--danger btn--sm" onClick={onStopAll}>
        ⏹ Stop All
      </button>

      <button className="btn btn--ghost btn--sm" onClick={onOpenOutput}>
        📂 Open Output
      </button>
    </header>
  );
};

export default TopBar;
