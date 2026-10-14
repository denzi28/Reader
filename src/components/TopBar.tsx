import { useRef, type ReactNode } from 'react';
import { useLiquidBar } from '../lib/liquid';
import { t } from '../lib/i18n';
import { BooksIcon, LeafMark, MarkIcon, ToolsIcon } from './icons';

export type DeskTab = 'shelf' | 'notes' | 'tools';

/** The desktop library's bar along the top: where to go, search, adding things and the account. */
export function TopBar({ tab, onTab, search, actions, account }: {
  tab: DeskTab;
  onTab: (t: DeskTab) => void;
  search: ReactNode;
  actions: ReactNode;
  account: ReactNode;
}) {
  const tabs = useRef<HTMLElement>(null);
  useLiquidBar(tabs, 'button', tab);
  const item = (id: DeskTab, icon: ReactNode, label: string) => (
    <button className={tab === id ? 'on' : ''} onClick={() => onTab(id)} aria-current={tab === id ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <header className="deskbar">
      <h1 className="brand"><LeafMark />Leafpage</h1>
      <nav className="top-tabs" aria-label={t('Sections')} ref={tabs}>
        {item('shelf', <BooksIcon />, t('Library'))}
        {item('notes', <MarkIcon />, t('Notes'))}
        {item('tools', <ToolsIcon />, t('PDF tools'))}
      </nav>
      <div className="top-right">
        {search}
        {actions}
        {account}
      </div>
    </header>
  );
}
