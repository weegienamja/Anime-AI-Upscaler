import React from 'react';
import type { Page } from '../App';

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

const NAV_ITEMS: { page: Page; icon: string; label: string }[] = [
  { page: 'newjob', icon: '🏠', label: 'New Job' },
  { page: 'queue', icon: '📋', label: 'Queue' },
  { page: 'presets', icon: '⚡', label: 'Presets' },
  { page: 'history', icon: '🕐', label: 'History' },
  { page: 'system', icon: '💻', label: 'System' },
  { page: 'account', icon: '👤', label: 'Account' },
  { page: 'settings', icon: '⚙️', label: 'Settings' },
];

const Sidebar: React.FC<SidebarProps> = ({ activePage, onNavigate }) => {
  return (
    <aside className="sidebar">
      <nav className="sidebar__nav">
        {NAV_ITEMS.map(({ page, icon, label }) => (
          <button
            key={page}
            className={`sidebar__item ${
              activePage === page ? 'sidebar__item--active' : ''
            }`}
            onClick={() => onNavigate(page)}
          >
            <span className="sidebar__icon">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;
