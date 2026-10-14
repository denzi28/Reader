import type { ReactNode } from 'react';
import { BooksIcon, MarkIcon, ToolsIcon } from './icons';

export type DeskTab = 'shelf' | 'notes' | 'tools';

/** The desktop library's bar along the top: where to go, search, adding things and the account. */
export function TopBar({ tab, onTab, search, actions, account }: {
  tab: DeskTab;
  onTab: (t: DeskTab) => void;
  search: ReactNode;
  actions: ReactNode;
  account: ReactNode;
}) {
  const item = (id: DeskTab, icon: ReactNode, label: string) => (
    <button className={tab === id ? 'on' : ''} onClick={() => onTab(id)} aria-current={tab === id ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <header className="deskbar">
      <h1 className="brand">The Reader</h1>
      <nav className="top-tabs" aria-label="Sections">
        {item('shelf', <BooksIcon />, 'Library')}
        {item('notes', <MarkIcon />, 'Notes')}
        {item('tools', <ToolsIcon />, 'PDF tools')}
      </nav>
      <div className="top-right">
        {search}
        {actions}
        {account}
      </div>
    </header>
  );
}
