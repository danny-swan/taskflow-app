// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// WorkspaceSettings — страница настроек текущего пространства (Wave A, PR-4).
//
// 4 вкладки: Статусы / Теги / Дедлайны / Участники (последняя — только shared).
// Шапка: имя ws + карандаш-переименование (owner). Внизу — soft-delete (owner;
// для personal задизейблено). Статусы/Теги переиспользуют секции из Settings.tsx
// (они уже ws-scoped). Роль/гейты — через useCurrentWorkspaceRole.
import { useState } from 'react';
import { Pencil, Check, X, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useCurrentWorkspace, useCurrentWorkspaceRole, useCanManageWorkspace } from '../store/workspaceScope';
import { tr } from '../lib/i18n';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatusesSection, TagsSection } from './Settings';
import { MembersTab } from '../components/MembersTab';
import { WorkspaceHistoryTab } from '../components/WorkspaceHistoryTab';

type Tab = 'statuses' | 'tags' | 'deadlines' | 'members' | 'history';

export function WorkspaceSettingsPage() {
  const lang = useStore(s => s.language);
  const ws = useCurrentWorkspace();
  const role = useCurrentWorkspaceRole();
  const renameWorkspace = useStore(s => s.renameWorkspace);
  const deleteWorkspace = useStore(s => s.deleteWorkspace);

  const isOwner = role === 'owner';
  const isShared = ws?.kind === 'shared';
  const isPersonal = ws?.kind === 'personal';

  const [tab, setTab] = useState<Tab>('statuses');
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startEdit = () => { setNameDraft(ws?.name ?? ''); setEditing(true); };
  const commitEdit = () => {
    const clean = nameDraft.trim();
    if (ws && clean.length >= 1 && clean.length <= 60 && clean !== ws.name) {
      renameWorkspace(ws.id, clean);
    }
    setEditing(false);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'statuses', label: tr(lang, 'ws_tab_statuses') },
    { key: 'tags', label: tr(lang, 'ws_tab_tags') },
    { key: 'deadlines', label: tr(lang, 'ws_tab_deadlines') },
    ...(isShared ? [{ key: 'members' as Tab, label: tr(lang, 'ws_tab_members') }] : []),
    ...(isShared ? [{ key: 'history' as Tab, label: tr(lang, 'ws_history_tab_title') }] : []),
  ];

  // Гарантируем валидный таб, если участники исчезли (переключение на personal).
  const activeTab: Tab = tabs.some(t => t.key === tab) ? tab : 'statuses';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-border-soft">
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <input
                autoFocus
                aria-label={tr(lang, 'ws_rename_aria')}
                value={nameDraft}
                maxLength={60}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="font-display text-[18px] font-semibold bg-surface-alt border border-border-soft rounded-lg px-2.5 py-1 outline-none focus:border-accent"
              />
              <button
                onClick={commitEdit}
                title={tr(lang, 'ws_rename_save')}
                className="p-1.5 text-accent hover:bg-surface-alt rounded"
              ><Check size={16} /></button>
              <button
                onClick={() => setEditing(false)}
                title={tr(lang, 'cancel')}
                className="p-1.5 text-muted hover:bg-surface-alt rounded"
              ><X size={16} /></button>
            </>
          ) : (
            <>
              <h1 className="font-display text-[18px] font-semibold">{ws?.name ?? tr(lang, 'ws_settings_title')}</h1>
              {isOwner && (
                <button
                  onClick={startEdit}
                  title={tr(lang, 'ws_rename_aria')}
                  aria-label={tr(lang, 'ws_rename_aria')}
                  className="p-1.5 text-muted hover:text-text hover:bg-surface-alt rounded"
                ><Pencil size={15} /></button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-[200px] shrink-0 border-r border-border-soft py-4 px-2.5 overflow-y-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={'w-full text-left px-3 py-1.5 mb-0.5 rounded-md text-[13px] ' +
                (activeTab === t.key ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-surface-alt')}
            >{t.label}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col">
          <div className="flex-1">
            {activeTab === 'statuses' && <StatusesSection />}
            {activeTab === 'tags' && <TagsSection />}
            {activeTab === 'deadlines' && <DeadlinesSection />}
            {activeTab === 'members' && isShared && <MembersTab />}
            {activeTab === 'history' && isShared && <WorkspaceHistoryTab />}
          </div>

          {isOwner && (
            <div className="mt-8 pt-5 border-t border-border-soft">
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={isPersonal}
                title={isPersonal ? tr(lang, 'ws_delete_personal_hint') : undefined}
                className={
                  'flex items-center gap-2 px-4 py-2 text-[13px] rounded-lg border transition-colors ' +
                  (isPersonal
                    ? 'border-border-soft text-faint cursor-not-allowed'
                    : 'border-[var(--status-important)]/40 text-[var(--status-important)] hover:bg-[var(--status-important)]/10')
                }
              >
                <Trash2 size={15} />
                {tr(lang, 'ws_delete_action')}
              </button>
              {isPersonal && (
                <p className="text-[11px] text-faint mt-1.5">{tr(lang, 'ws_delete_personal_hint')}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={tr(lang, 'ws_delete_confirm_title')}
        message={tr(lang, 'ws_delete_confirm_msg')}
        confirmLabel={tr(lang, 'ws_delete_action')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { if (ws) deleteWorkspace(ws.id); setConfirmDelete(false); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/**
 * Вкладка «Дедлайны» — режим подсчёта просрочки (ws-scoped через overdueMode).
 * overdueMode мапится в sync_workspace_settings (owner-only на сервере, 0031),
 * поэтому переключатель доступен только владельцу (Bug #5).
 */
function DeadlinesSection() {
  const lang = useStore(s => s.language);
  const overdueMode = useStore(s => s.overdueMode);
  const setOverdueMode = useStore(s => s.setOverdueMode);
  const canManage = useCanManageWorkspace();

  return (
    <div className="max-w-2xl">
      <h3 className="font-display text-[16px] font-semibold mb-3">{tr(lang, 'ws_tab_deadlines')}</h3>
      <div className="flex gap-2 mb-2">
        {(['calendar', 'business'] as const).map(m => (
          <button
            key={m}
            onClick={() => setOverdueMode(m)}
            disabled={!canManage}
            title={!canManage ? tr(lang, 'ws_owner_only_reference') : undefined}
            className={'px-3 py-1.5 text-[13px] rounded border ' +
              (overdueMode === m ? 'bg-accent text-white border-accent' : 'border-border-soft hover:bg-surface-alt') +
              (!canManage ? ' opacity-60 cursor-not-allowed' : '')}
          >
            {m === 'calendar' ? tr(lang, 'ws_deadline_calendar') : tr(lang, 'ws_deadline_business')}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted">{tr(lang, 'ws_deadlines_hint')}</p>
      {!canManage && (
        <p className="text-[11px] text-muted mt-1.5">{tr(lang, 'ws_owner_only_reference')}</p>
      )}
    </div>
  );
}
