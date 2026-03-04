import React from 'react';
import { PreviewResult } from '../../shared/types';

interface PreviewPanelProps {
  preview: PreviewResult | null;
  loading: boolean;
  onRunPreview: () => void;
  hasFiles: boolean;
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  preview,
  loading,
  onRunPreview,
  hasFiles,
}) => {
  return (
    <div className="preview-panel">
      <div className="preview-comparison">
        <div>
          <div className="preview-comparison__label preview-comparison__label--before">
            Before
          </div>
          <div className="preview-img-wrapper">
            {preview?.beforePath ? (
              <img
                src={`file://${preview.beforePath}`}
                alt="Before"
                draggable={false}
              />
            ) : (
              <span className="preview-placeholder">No preview</span>
            )}
          </div>
        </div>
        <div>
          <div className="preview-comparison__label preview-comparison__label--after">
            After
          </div>
          <div className="preview-img-wrapper">
            {preview?.afterPath ? (
              <img
                src={`file://${preview.afterPath}`}
                alt="After"
                draggable={false}
              />
            ) : (
              <span className="preview-placeholder">No preview</span>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <div className="preview-stats">
          <span>Processing time: {(preview.elapsedMs / 1000).toFixed(1)}s</span>
          <span>256×256 crop</span>
        </div>
      )}

      <button
        className="btn btn--ghost"
        onClick={onRunPreview}
        disabled={!hasFiles || loading}
        style={{ alignSelf: 'center', marginTop: 8 }}
      >
        {loading ? '⏳ Processing...' : '🔍 Run Preview'}
      </button>
    </div>
  );
};

export default PreviewPanel;
