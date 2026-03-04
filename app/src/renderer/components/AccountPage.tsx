import React, { useState, useEffect, useCallback } from 'react';
import { EntitlementStatus } from '../../shared/types';

const AccountPage: React.FC = () => {
  const [status, setStatus] = useState<EntitlementStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await window.api.getAuthStatus();
      setStatus(s);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load account status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Listen for auth status changes (e.g. after deep link callback)
  useEffect(() => {
    const unsub = window.api.onAuthStatusChanged((s: EntitlementStatus) => {
      setStatus(s);
      setLoading(false);
    });
    return unsub;
  }, []);

  const handleLogin = useCallback(async () => {
    try {
      setError(null);
      await window.api.startLogin();
    } catch (err: any) {
      setError(err.message || 'Failed to start login');
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const s = await window.api.refreshAuth();
      setStatus(s);
    } catch (err: any) {
      setError(err.message || 'Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await window.api.logout();
      setStatus({ loggedIn: false, entitled: false });
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to log out');
    }
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="page-title">Account</h1>
        <div className="empty-state">
          <div className="empty-state__text">Loading account info...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="page-title">Account</h1>

      {error && (
        <div className="account-error" style={{
          background: 'rgba(220, 53, 69, 0.15)',
          border: '1px solid var(--danger)',
          borderRadius: 8,
          padding: '10px 16px',
          marginBottom: 16,
          color: 'var(--danger)',
          fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {!status?.loggedIn ? (
        /* ─── Logged Out State ─────────────────────────────────────── */
        <div className="settings-section">
          <div className="settings-section__title">Not Logged In</div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
            Log in with your Patreon account to activate your license.
            An active subscription is required to run upscaling jobs.
          </p>
          <button className="btn btn--primary" onClick={handleLogin}>
            🔗 Log in with Patreon
          </button>
        </div>
      ) : (
        /* ─── Logged In State ──────────────────────────────────────── */
        <>
          <div className="settings-section">
            <div className="settings-section__title">Profile</div>
            <div className="account-info-grid" style={{
              display: 'grid',
              gridTemplateColumns: '160px 1fr',
              gap: '8px 16px',
              fontSize: 14,
            }}>
              <span style={{ color: 'var(--text-secondary)' }}>Display Name:</span>
              <span style={{ fontWeight: 600 }}>{status.displayName || '—'}</span>

              <span style={{ color: 'var(--text-secondary)' }}>User ID:</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {status.userId || '—'}
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Patreon ID:</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {status.patreonUserId || '—'}
              </span>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section__title">Entitlement</div>
            <div className="account-info-grid" style={{
              display: 'grid',
              gridTemplateColumns: '160px 1fr',
              gap: '8px 16px',
              fontSize: 14,
            }}>
              <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
              <span style={{
                fontWeight: 700,
                color: status.entitled ? 'var(--success)' : 'var(--danger)',
              }}>
                {status.entitled ? '✓ Active' : '✗ Expired / Inactive'}
              </span>

              <span style={{ color: 'var(--text-secondary)' }}>Tier:</span>
              <span style={{ textTransform: 'capitalize' }}>{status.tier || '—'}</span>

              {status.issuedAt && (
                <>
                  <span style={{ color: 'var(--text-secondary)' }}>Issued At:</span>
                  <span>{new Date(status.issuedAt).toLocaleString()}</span>
                </>
              )}

              {status.expiresAt && (
                <>
                  <span style={{ color: 'var(--text-secondary)' }}>Expires At:</span>
                  <span>{new Date(status.expiresAt).toLocaleString()}</span>
                </>
              )}

              {status.lastVerifiedAt && (
                <>
                  <span style={{ color: 'var(--text-secondary)' }}>Last Verified:</span>
                  <span>{new Date(status.lastVerifiedAt).toLocaleString()}</span>
                </>
              )}

              {status.offlineGraceDeadline && (
                <>
                  <span style={{ color: 'var(--text-secondary)' }}>Offline Grace Until:</span>
                  <span>{new Date(status.offlineGraceDeadline).toLocaleString()}</span>
                </>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button
              className="btn btn--primary"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? '⟳ Refreshing...' : '🔄 Refresh Verification'}
            </button>
            <button className="btn btn--danger" onClick={handleLogout}>
              🚪 Log Out
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default AccountPage;
