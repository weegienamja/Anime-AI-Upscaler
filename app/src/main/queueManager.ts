import { EventEmitter } from 'events';
import { Job, JobStatus } from '../shared/types';
import { jobRunner } from './jobRunner';
import { database } from './database';

export interface QueueState {
  jobs: Job[];
  isPaused: boolean;
  runningCount: number;
  maxConcurrent: number;
}

/**
 * Manages the job queue: ordering, concurrency, pause/resume,
 * retry with reduced tile size on OOM.
 */
export class QueueManager extends EventEmitter {
  private queue: Job[] = [];
  private isPaused = false;
  private maxConcurrent = 1;
  private runningIds = new Set<string>();
  private readonly MAX_OOM_RETRIES = 3;
  private readonly TILE_REDUCE_FACTOR = 0.5;
  private readonly TILE_SIZES = [400, 200, 100, 64, 32];

  constructor() {
    super();
    this.setupRunnerListeners();
  }

  private setupRunnerListeners() {
    jobRunner.on('progress', (jobId: string, progress: number) => {
      const job = this.findJob(jobId);
      if (job) {
        job.progress = progress;
        this.emit('jobProgress', job);
      }
    });

    jobRunner.on('log', (jobId: string, line: string) => {
      const job = this.findJob(jobId);
      if (job) {
        job.stdoutLog.push(line);
        // Keep last 500 lines
        if (job.stdoutLog.length > 500) {
          job.stdoutLog = job.stdoutLog.slice(-500);
        }
        this.emit('jobLog', jobId, line);
      }
    });

    jobRunner.on('completed', (jobId: string) => {
      const job = this.findJob(jobId);
      if (job) {
        this.updateJobStatus(job, 'completed');
        job.completedAt = new Date().toISOString();
        job.progress = 100;
        this.runningIds.delete(jobId);
        database.saveHistory(job);
        this.emit('jobCompleted', job);
        this.processNext();
      }
    });

    jobRunner.on('failed', (jobId: string, error: string) => {
      const job = this.findJob(jobId);
      if (job) {
        this.updateJobStatus(job, 'failed');
        job.error = error;
        this.runningIds.delete(jobId);
        database.saveHistory(job);
        this.emit('jobFailed', job);
        this.processNext();
      }
    });

    jobRunner.on('oom', (jobId: string) => {
      const job = this.findJob(jobId);
      if (job && job.retryCount < this.MAX_OOM_RETRIES) {
        // Cancel current run, reduce tile size, retry
        jobRunner.cancel(jobId);
        this.runningIds.delete(jobId);
        job.retryCount++;
        job.error = undefined;

        // Reduce tile size
        const currentTile = job.config.tileSize || 400;
        const nextTile = this.getReducedTileSize(currentTile);
        job.config.tileSize = nextTile;

        job.stdoutLog.push(
          `[Queue] OOM detected, retrying with tile size ${nextTile} (attempt ${job.retryCount}/${this.MAX_OOM_RETRIES})`
        );
        this.emit('jobLog', jobId, job.stdoutLog[job.stdoutLog.length - 1]);

        this.updateJobStatus(job, 'queued');
        // Re-queue at front
        this.queue = [job, ...this.queue.filter((j) => j.id !== jobId)];
        this.processNext();
      }
    });
  }

  private getReducedTileSize(current: number): number {
    const reduced = Math.floor(current * this.TILE_REDUCE_FACTOR);
    // Find the closest standard tile size that's smaller
    for (const ts of this.TILE_SIZES) {
      if (ts < current) return ts;
    }
    return 32; // minimum
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  addJob(job: Job): void {
    job.status = 'queued';
    this.queue.push(job);
    this.emit('queueChanged', this.getState());
    this.processNext();
  }

  /** Run a job immediately, bypassing queue order */
  runNow(job: Job): void {
    job.status = 'queued';
    this.queue = [job, ...this.queue];
    this.emit('queueChanged', this.getState());
    this.processNext();
  }

  cancelJob(jobId: string): void {
    const job = this.findJob(jobId);
    if (!job) return;

    if (job.status === 'running') {
      jobRunner.cancel(jobId);
      this.runningIds.delete(jobId);
    }

    this.updateJobStatus(job, 'cancelled');
    this.queue = this.queue.filter((j) => j.id !== jobId);
    this.emit('queueChanged', this.getState());
    this.processNext();
  }

  retryJob(jobId: string): void {
    const job = this.findJob(jobId);
    if (job && (job.status === 'failed' || job.status === 'cancelled')) {
      job.error = undefined;
      job.progress = 0;
      job.processedFiles = 0;
      job.retryCount = 0;
      this.updateJobStatus(job, 'queued');
      this.emit('queueChanged', this.getState());
      this.processNext();
    }
  }

  moveJob(jobId: string, direction: 'up' | 'down'): void {
    const idx = this.queue.findIndex((j) => j.id === jobId);
    if (idx < 0) return;

    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= this.queue.length) return;

    // Don't move past running jobs
    if (this.queue[newIdx].status === 'running') return;

    [this.queue[idx], this.queue[newIdx]] = [this.queue[newIdx], this.queue[idx]];
    this.emit('queueChanged', this.getState());
  }

  pause(): void {
    this.isPaused = true;
    this.emit('queueChanged', this.getState());
  }

  resume(): void {
    this.isPaused = false;
    this.emit('queueChanged', this.getState());
    this.processNext();
  }

  stopAll(): void {
    jobRunner.cancelAll();
    this.runningIds.clear();

    for (const job of this.queue) {
      if (job.status === 'running') {
        this.updateJobStatus(job, 'cancelled');
      }
    }

    this.isPaused = true;
    this.emit('queueChanged', this.getState());
  }

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = Math.max(1, n);
    this.processNext();
  }

  getState(): QueueState {
    return {
      jobs: [...this.queue],
      isPaused: this.isPaused,
      runningCount: this.runningIds.size,
      maxConcurrent: this.maxConcurrent,
    };
  }

  getJob(jobId: string): Job | undefined {
    return this.findJob(jobId);
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private findJob(jobId: string): Job | undefined {
    return this.queue.find((j) => j.id === jobId);
  }

  private updateJobStatus(job: Job, status: JobStatus): void {
    job.status = status;
    if (status === 'running') {
      job.startedAt = new Date().toISOString();
    }
    this.emit('jobStatus', job);
  }

  private processNext(): void {
    if (this.isPaused) return;

    while (this.runningIds.size < this.maxConcurrent) {
      const next = this.queue.find(
        (j) => j.status === 'queued' && !this.runningIds.has(j.id)
      );
      if (!next) break;

      this.runningIds.add(next.id);
      this.updateJobStatus(next, 'running');

      jobRunner.run(next).catch(() => {
        // Errors handled via event listeners above
      });
    }
  }
}

export const queueManager = new QueueManager();
