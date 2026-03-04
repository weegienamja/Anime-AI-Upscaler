import React, { useState, useEffect, useCallback } from 'react';
import { Job, JobStatus } from '../../shared/types';

const QueuePage: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [logs, setLogs] = useState<Map<string, string[]>>(new Map());

  // Load queue state
  useEffect(() => {
    window.api.getQueueState().then((state) => {
      setJobs(state.jobs);
      setIsPaused(state.isPaused);
    });
  }, []);

  // Subscribe to events
  useEffect(() => {
    const unsubStatus = window.api.onJobStatus((job: Job) => {
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === job.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = job;
          return updated;
        }
        return [...prev, job];
      });
    });

    const unsubProgress = window.api.onJobProgress(
      ({ jobId, progress }: { jobId: string; progress: number }) => {
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, progress } : j))
        );
      }
    );

    const unsubLog = window.api.onJobLog(
      ({ jobId, line }: { jobId: string; line: string }) => {
        setLogs((prev) => {
          const newMap = new Map(prev);
          const existing = newMap.get(jobId) || [];
          newMap.set(jobId, [...existing.slice(-200), line]);
          return newMap;
        });
      }
    );

    const unsubQueue = window.api.onQueueState((state: any) => {
      setJobs(state.jobs);
      setIsPaused(state.isPaused);
    });

    return () => {
      unsubStatus();
      unsubProgress();
      unsubLog();
      unsubQueue();
    };
  }, []);

  const handleCancel = useCallback((jobId: string) => {
    window.api.cancelJob(jobId);
  }, []);

  const handleRetry = useCallback((jobId: string) => {
    window.api.retryJob(jobId);
  }, []);

  const handleMoveUp = useCallback((jobId: string) => {
    window.api.moveJob(jobId, 'up');
  }, []);

  const handleMoveDown = useCallback((jobId: string) => {
    window.api.moveJob(jobId, 'down');
  }, []);

  const getStatusClass = (status: JobStatus) => `queue-item__status--${status}`;
  const getStatusBadge = (status: JobStatus) => `status-badge--${status}`;

  const selectedJobData = jobs.find((j) => j.id === selectedJob);
  const selectedLogs = selectedJob ? logs.get(selectedJob) || [] : [];

  return (
    <div>
      <h1 className="page-title">
        Queue {isPaused && <span className="status-badge status-badge--paused">PAUSED</span>}
      </h1>

      {jobs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">📭</div>
          <div className="empty-state__text">Queue is empty</div>
        </div>
      ) : (
        <div className="queue-list">
          {jobs.map((job, idx) => (
            <div
              key={job.id}
              className="queue-item"
              onClick={() => setSelectedJob(job.id === selectedJob ? null : job.id)}
              style={{ cursor: 'pointer' }}
            >
              <div className={`queue-item__status ${getStatusClass(job.status)}`} />
              <div className="queue-item__info">
                <div className="queue-item__name">{job.name}</div>
                <div className="queue-item__meta">
                  {job.config.engine} • {job.config.scale}x • noise{job.config.noise}
                  {job.error && (
                    <span style={{ color: 'var(--danger)', marginLeft: 8 }}>
                      {job.error}
                    </span>
                  )}
                </div>
              </div>

              <span className={`status-badge ${getStatusBadge(job.status)}`}>
                {job.status}
              </span>

              <div className="queue-item__progress">
                <div
                  className="queue-item__progress-bar"
                  style={{ width: `${job.progress}%` }}
                />
              </div>

              <div className="queue-item__actions">
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveUp(job.id);
                  }}
                  disabled={idx === 0 || job.status === 'running'}
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveDown(job.id);
                  }}
                  disabled={idx === jobs.length - 1 || job.status === 'running'}
                  title="Move down"
                >
                  ▼
                </button>
                {job.status === 'completed' && (
                  <button
                    className="btn btn--sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.api.openFolder(job.outputDir);
                    }}
                    title="Open output folder"
                    style={{ fontSize: '0.75rem' }}
                  >
                    📂 Output
                  </button>
                )}
                {(job.status === 'failed' || job.status === 'cancelled') && (
                  <button
                    className="btn btn--warning btn--sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRetry(job.id);
                    }}
                    title="Retry"
                  >
                    🔄
                  </button>
                )}
                {(job.status === 'queued' || job.status === 'running') && (
                  <button
                    className="btn btn--danger btn--sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancel(job.id);
                    }}
                    title="Cancel"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Selected Job Details / Log ─────────────────────────────── */}
      {selectedJobData && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card__title">
            Job Log: {selectedJobData.name}
          </div>
          <div className="log-output">
            {selectedLogs.length > 0
              ? selectedLogs.join('\n')
              : selectedJobData.stdoutLog?.join('\n') || 'No log output yet...'}
          </div>
        </div>
      )}
    </div>
  );
};

export default QueuePage;
