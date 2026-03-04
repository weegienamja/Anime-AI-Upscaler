import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import NewJob from './components/NewJob';
import QueuePage from './components/QueuePage';
import PresetManager from './components/PresetManager';
import HistoryPage from './components/HistoryPage';
import SystemPage from './components/SystemPage';
import SettingsPage from './components/SettingsPage';
import AccountPage from './components/AccountPage';
import { GpuInfo, AppSettings, Job } from '../shared/types';

export type Page = 'newjob' | 'queue' | 'presets' | 'history' | 'system' | 'account' | 'settings';

const App: React.FC = () => {
  const [page, setPage] = useState<Page>('newjob');
  const [gpus, setGpus] = useState<GpuInfo[]>([]);
  const [selectedGpu, setSelectedGpu] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [queueState, setQueueState] = useState<{
    jobs: Job[];
    isPaused: boolean;
    runningCount: number;
  }>({ jobs: [], isPaused: false, runningCount: 0 });

  // Load initial data
  useEffect(() => {
    window.api.getSystemInfo().then((info) => {
      setGpus(info.gpus);
    });
    window.api.getSettings().then((s) => {
      setSettings(s);
      setSelectedGpu(s.selectedGpuId);
    });
    window.api.getQueueState().then(setQueueState);
  }, []);

  // Subscribe to queue updates
  useEffect(() => {
    const unsub = window.api.onQueueState((state) => {
      setQueueState(state);
    });
    return unsub;
  }, []);

  const handlePause = useCallback(() => {
    if (queueState.isPaused) {
      window.api.resumeQueue();
    } else {
      window.api.pauseQueue();
    }
  }, [queueState.isPaused]);

  const handleStopAll = useCallback(() => {
    window.api.stopAll();
  }, []);

  const handleOpenOutput = useCallback(() => {
    if (settings?.defaultOutputDir) {
      window.api.openFolder(settings.defaultOutputDir);
    }
  }, [settings]);

  const handleGpuChange = useCallback(
    (gpuId: number) => {
      setSelectedGpu(gpuId);
      if (settings) {
        const updated = { ...settings, selectedGpuId: gpuId };
        setSettings(updated);
        window.api.setSettings(updated);
      }
    },
    [settings]
  );

  const renderPage = () => {
    switch (page) {
      case 'newjob':
        return <NewJob selectedGpu={selectedGpu} settings={settings} />;
      case 'queue':
        return <QueuePage />;
      case 'presets':
        return <PresetManager />;
      case 'history':
        return <HistoryPage />;
      case 'system':
        return <SystemPage />;
      case 'account':
        return <AccountPage />;
      case 'settings':
        return <SettingsPage settings={settings} onSave={setSettings} />;
      default:
        return <NewJob selectedGpu={selectedGpu} settings={settings} />;
    }
  };

  // Calculate overall queue progress
  const totalJobs = queueState.jobs.length;
  const completedJobs = queueState.jobs.filter(
    (j) => j.status === 'completed'
  ).length;
  const overallProgress = totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0;

  return (
    <>
      <TopBar
        gpus={gpus}
        selectedGpu={selectedGpu}
        onGpuChange={handleGpuChange}
        isPaused={queueState.isPaused}
        onTogglePause={handlePause}
        onStopAll={handleStopAll}
        onOpenOutput={handleOpenOutput}
      />
      <div className="app-layout">
        <Sidebar activePage={page} onNavigate={setPage} />
        <main className="main-content">{renderPage()}</main>
      </div>
      <div className="queue-status-bar">
        <span>Queue Status</span>
        <div className="queue-status-bar__progress">
          <div
            className="queue-status-bar__progress-fill"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
        <span>
          Queued: {queueState.jobs.filter((j) => j.status === 'queued').length}
        </span>
        <span>Running: {queueState.runningCount}</span>
        <span>
          Done: {completedJobs}/{totalJobs}
        </span>
      </div>
    </>
  );
};

export default App;
