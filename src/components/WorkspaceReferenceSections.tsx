// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// WorkspaceReferenceSections — ws-scoped справочники «Статусы» и «Теги» (F49, ADR 0035).
//
// До v1.1.3 обе секции жили в `src/pages/Settings.tsx` и рендерились ОДНОВРЕМЕННО
// на двух экранах: в общих настройках (`/settings`) и в настройках пространства
// (`/workspace-settings`, который импортировал их прямо из страницы Settings).
// Один и тот же справочник имел две точки входа, а страница импортировала страницу.
// По ADR 0035 справочники принадлежат пространству, поэтому единственный их экран —
// `/workspace-settings`, а сами компоненты вынесены сюда, чтобы у них не было
// владельца в лице другой страницы.
//
// Ролевые гейты НЕ менялись: `useCanManageWorkspace()` (Bug #5) оставляет
// editor'у/viewer'у read-only, как и раньше (ср. ADR 0034 — ограничения экрана
// настроек пространства живут ВНУТРИ экрана).
import { useState } from 'react';
import { Trash2, GripVertical, Plus } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useCurrentWorkspaceStatuses, useCurrentWorkspaceTags, useCanManageWorkspace } from '../store/workspaceScope';
import { tr } from '../lib/i18n';
import { ConfirmDialog } from './ConfirmDialog';

export function TagsSection() {
  const lang = useStore(s => s.language);
  const canManage = useCanManageWorkspace(); // Bug #5: справочник/настройки — только owner (viewer/editor read-only)
  const tags = useCurrentWorkspaceTags();
  const addTag = useStore(s => s.addTag);
  const updateTag = useStore(s => s.updateTag);
  const deleteTag = useStore(s => s.deleteTag);

  const [confirmId, setConfirmId] = useState<number | null>(null);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_tags')}</h3>
        {canManage && (
          <button
            onClick={() => addTag('NEW' + (tags.length + 1), '#5B7FB8')}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
          >
            <Plus className="w-4 h-4" />
            {lang === 'ru' ? 'Добавить тэг' : 'Add tag'}
          </button>
        )}
      </div>
      {!canManage && (
        <p className="text-[12px] text-muted mb-3">{tr(lang, 'ws_owner_only_reference')}</p>
      )}
      <div className="border border-border-soft rounded-lg max-h-[60vh] overflow-y-auto bg-surface">
        {tags.map(t => (
          <div key={t.id} className="flex items-center gap-3 px-3 py-2 border-b border-border-soft last:border-b-0">
            <input
              type="color" value={t.color}
              disabled={!canManage}
              onChange={(e) => updateTag(t.id, { color: e.target.value })}
              className={'w-7 h-7 border-0 bg-transparent ' + (canManage ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}
            />
            <input
              value={t.name}
              disabled={!canManage}
              onChange={(e) => updateTag(t.id, { name: e.target.value })}
              className="flex-1 bg-transparent border-0 outline-none text-[13px] font-mono uppercase disabled:opacity-60"
            />
            {canManage && (
              <button
                onClick={() => setConfirmId(t.id)}
                className="p-1 text-muted hover:text-[var(--status-important)]"
              ><Trash2 size={14} /></button>
            )}
          </div>
        ))}
        {tags.length === 0 && <div className="px-3 py-8 text-center text-muted text-[13px]">—</div>}
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        title={lang === 'ru' ? 'Удалить тэг?' : 'Delete tag?'}
        message={lang === 'ru' ? 'Тэг будет удалён из всех задач.' : 'The tag will be removed from all tasks.'}
        confirmLabel={tr(lang, 'delete')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { if (confirmId !== null) deleteTag(confirmId); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}

export function StatusesSection() {
  const lang = useStore(s => s.language);
  const canManage = useCanManageWorkspace(); // Bug #5: справочник/настройки — только owner (viewer/editor read-only)
  const statuses = useCurrentWorkspaceStatuses();
  const addStatus = useStore(s => s.addStatus);
  const updateStatus = useStore(s => s.updateStatus);
  const deleteStatus = useStore(s => s.deleteStatus);
  const reorderStatuses = useStore(s => s.reorderStatuses);

  const [confirmId, setConfirmId] = useState<number | null>(null);

  const nonTech = statuses.filter(s => s.is_technical !== 1);

  const move = (i: number, dir: -1 | 1) => {
    const ids = statuses.map(s => s.id);
    const fullIdx = statuses.findIndex(s => s.id === nonTech[i]?.id);
    const j = fullIdx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[fullIdx], ids[j]] = [ids[j], ids[fullIdx]];
    reorderStatuses(ids);
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_statuses')}</h3>
        {canManage && (
          <button
            onClick={() => addStatus('Новый', '#5B7FB8', 'middle')}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
          >
            <Plus className="w-4 h-4" />
            {lang === 'ru' ? 'Добавить статус' : 'Add status'}
          </button>
        )}
      </div>
      {!canManage && (
        <p className="text-[12px] text-muted mb-3">{tr(lang, 'ws_owner_only_reference')}</p>
      )}
      <div className="border border-border-soft rounded-lg max-h-[60vh] overflow-y-auto bg-surface">
        {nonTech.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 px-3 py-2 border-b border-border-soft last:border-b-0">
            {canManage && (
              <div className="flex flex-col">
                <button onClick={() => move(i, -1)} className="text-muted hover:text-text leading-none text-[10px]">▲</button>
                <button onClick={() => move(i, 1)} className="text-muted hover:text-text leading-none text-[10px]">▼</button>
              </div>
            )}
            <GripVertical size={14} className="text-faint" />
            <input
              type="color" value={s.color}
              disabled={!canManage}
              onChange={(e) => updateStatus(s.id, { color: e.target.value })}
              className={'w-7 h-7 border-0 bg-transparent ' + (canManage ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}
            />
            <input
              value={s.name}
              disabled={!canManage}
              onChange={(e) => updateStatus(s.id, { name: e.target.value })}
              className="flex-1 bg-transparent border-0 outline-none text-[13px] disabled:opacity-60"
            />
            {/* Task 8: TWO independent checkboxes: hidden + default_collapsed */}
            <label className={'flex items-center gap-1 text-[11px] text-muted select-none shrink-0 ' + (canManage ? 'cursor-pointer' : 'cursor-not-allowed')}>
              <input
                type="checkbox"
                checked={!!s.hidden}
                disabled={!canManage}
                onChange={(e) => updateStatus(s.id, { hidden: e.target.checked ? 1 : 0 })}
                className="w-3.5 h-3.5 accent-[var(--accent)] disabled:cursor-not-allowed"
              />
              {lang === 'ru' ? 'Скрытый' : 'Hidden'}
            </label>
            <label className={'flex items-center gap-1 text-[11px] text-muted select-none shrink-0 ' + (canManage ? 'cursor-pointer' : 'cursor-not-allowed')}>
              <input
                type="checkbox"
                checked={!!s.default_collapsed}
                disabled={!canManage}
                onChange={(e) => updateStatus(s.id, { default_collapsed: e.target.checked ? 1 : 0 })}
                className="w-3.5 h-3.5 accent-[var(--accent)] disabled:cursor-not-allowed"
              />
              {lang === 'ru' ? 'Свёрнут' : 'Collapsed'}
            </label>
            {/* v0.8.11: статус «Выполнено» (behavior=archive, non-technical) системный и неудаляемый —
                без него сломается кнопка-галочка выполнения в карточке задачи. */}
            {s.behavior === 'archive' ? (
              <span
                className="text-[10px] text-muted px-1.5 py-0.5 rounded border border-border-soft shrink-0"
                title={lang === 'ru'
                  ? 'Системный статус — не удаляется'
                  : 'System status — cannot be deleted'}
              >
                {lang === 'ru' ? 'системный' : 'system'}
              </span>
            ) : canManage ? (
              <button
                onClick={() => setConfirmId(s.id)}
                className="p-1 text-muted hover:text-[var(--status-important)]"
              ><Trash2 size={14} /></button>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted mt-2">
        {lang === 'ru'
          ? '«Скрытый» — статус не показывается на доске задач. «Свёрнут» — секция свёрнута по умолчанию. Статус «Выполнено» — системный и не удаляется.'
          : '"Hidden" — status is hidden from the task board. "Collapsed" — section is collapsed by default. "Done" is a system status and cannot be deleted.'}
      </p>

      <ConfirmDialog
        open={confirmId !== null}
        title={lang === 'ru' ? 'Удалить статус?' : 'Delete status?'}
        message={lang === 'ru' ? 'Задачи с этим статусом потеряют его.' : 'Tasks with this status will lose it.'}
        confirmLabel={tr(lang, 'delete')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { if (confirmId !== null) deleteStatus(confirmId); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
