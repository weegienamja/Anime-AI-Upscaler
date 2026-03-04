import React, { useState, useEffect } from 'react';
import { SystemInfo } from '../../shared/types';

const SystemPage: React.FC = () => {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [benchmarkResult, setBenchmarkResult] = useState<string | null>(null);

  useEffect(() => {
    window.api
      .getSystemInfo()
      .then(setInfo)
      .finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    const newInfo = await window.api.getSystemInfo();
    setInfo(newInfo);
    setLoading(false);
  };

  const handleBenchmark = async () => {
    setBenchmarkResult('Running benchmark...');
    const result = await window.api.runBenchmark();
    setBenchmarkResult(result.message || JSON.stringify(result));
  };

  if (loading && !info) {
    return (
      <div>
        <h1 className="page-title">System</h1>
        <div className="empty-state">
          <div className="empty-state__text">Loading system info...</div>
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
          System
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--ghost btn--sm" onClick={handleRefresh}>
            🔄 Refresh
          </button>
          <button className="btn btn--primary btn--sm" onClick={handleBenchmark}>
            ⚡ Benchmark
          </button>
        </div>
      </div>

      {info && (
        <div className="system-grid">
          {/* GPU Info */}
          <div className="card">
            <div className="card__title">GPU</div>
            {info.gpus.map((gpu) => (
              <div key={gpu.id}>
                <div className="system-stat">
                  <span className="system-stat__label">Name</span>
                  <span className="system-stat__value">{gpu.name}</span>
                </div>
                <div className="system-stat">
                  <span className="system-stat__label">Vendor</span>
                  <span className="system-stat__value">{gpu.vendor}</span>
                </div>
                <div className="system-stat">
                  <span className="system-stat__label">VRAM</span>
                  <span className="system-stat__value">
                    {gpu.vramMB > 0
                      ? `${(gpu.vramMB / 1024).toFixed(1)} GB`
                      : 'Unknown'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* CPU Info */}
          <div className="card">
            <div className="card__title">CPU</div>
            <div className="system-stat">
              <span className="system-stat__label">Model</span>
              <span className="system-stat__value">{info.cpuModel}</span>
            </div>
            <div className="system-stat">
              <span className="system-stat__label">Cores</span>
              <span className="system-stat__value">{info.cpuCores}</span>
            </div>
          </div>

          {/* Memory */}
          <div className="card">
            <div className="card__title">Memory</div>
            <div className="system-stat">
              <span className="system-stat__label">Total RAM</span>
              <span className="system-stat__value">
                {(info.ramTotalMB / 1024).toFixed(1)} GB
              </span>
            </div>
            <div className="system-stat">
              <span className="system-stat__label">Free RAM</span>
              <span className="system-stat__value">
                {(info.ramFreeMB / 1024).toFixed(1)} GB
              </span>
            </div>
            <div className="system-stat">
              <span className="system-stat__label">Usage</span>
              <span className="system-stat__value">
                {(
                  ((info.ramTotalMB - info.ramFreeMB) / info.ramTotalMB) *
                  100
                ).toFixed(0)}
                %
              </span>
            </div>
          </div>

          {/* Disk */}
          <div className="card">
            <div className="card__title">Disk</div>
            <div className="system-stat">
              <span className="system-stat__label">Total</span>
              <span className="system-stat__value">{info.diskTotalGB} GB</span>
            </div>
            <div className="system-stat">
              <span className="system-stat__label">Free</span>
              <span className="system-stat__value">{info.diskFreeGB} GB</span>
            </div>
            <div className="system-stat">
              <span className="system-stat__label">Used</span>
              <span className="system-stat__value">
                {(info.diskTotalGB - info.diskFreeGB).toFixed(1)} GB
              </span>
            </div>
          </div>
        </div>
      )}

      {benchmarkResult && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card__title">Benchmark Result</div>
          <div className="log-output">{benchmarkResult}</div>
        </div>
      )}
    </div>
  );
};

export default SystemPage;
