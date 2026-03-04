import React, { useState, useEffect } from 'react';
import { HistoryEntry } from '../../shared/types';

const HistoryPage: React.FC = () => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    window.api.listHistory().then(setEntries);
  }, []);

  const handleClear = async () => {
    await window.api.clearHistory();
    setEntries([]);
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString();
  };

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
          History
        </h1>
        {entries.length > 0 && (
          <button className="btn btn--danger btn--sm" onClick={handleClear}>
            🗑️ Clear History
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">🕐</div>
          <div className="empty-state__text">No history yet</div>
        </div>
      ) : (
        <table className="history-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Engine</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Date</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.jobName}</td>
                <td>{entry.engine}</td>
                <td>
                  <span className={`status-badge status-badge--${entry.status}`}>
                    {entry.status}
                  </span>
                </td>
                <td>{formatDuration(entry.elapsedMs)}</td>
                <td>{formatDate(entry.createdAt)}</td>
                <td
                  style={{
                    color: entry.error ? 'var(--danger)' : 'var(--text-muted)',
                    maxWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={entry.error || ''}
                >
                  {entry.error || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default HistoryPage;
