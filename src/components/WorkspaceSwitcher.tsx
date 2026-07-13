// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// WorkspaceSwitcher — переключатель пространств.
//
// Wave A (PR-3): базовый дропдаун с группами «Личные»/«Общие».
// Wave B (PR-b-05): role-badge у shared-пространств (Editor/Viewer; owner и
// personal — без badge), сортировка (активный первым, остальные по алфавиту),
// пустое состояние секции «Общие» с TF-ID пользователя.
//
// Индикатор pending-инвайтов здесь НЕ добавляется намеренно: единственное место
// их отображения — <MyInvitesSection /> (PR-b-04) в том же сайдбаре. Дублировать
// счётчик рядом с заголовком «Общие» — значит показывать одно состояние в двух
// местах; выбран безопасный вариант 5.b брифа (без нового индикатора).
//
// Дизайн повторяет паттерн дропдауна темы (surface + border + shadow, scale-in).
import { NavLink } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import {
  Plus, ChevronsUpDown, Check, Users, User as UserIcon, Settings2, Pencil, Eye,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  useWorkspaces, useCurrentWorkspace, useCanEdit, useWorkspaceRoles,
  type WorkspaceRole,
} from '../store/workspaceScope';
import { CreateWorkspaceModal } from './CreateWorkspaceModal';
import { tr } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useProfile } from '../lib/profile';
import type { Workspace } from '../store/useStore';

/** Активный первым, остальные — по алфавиту названия. */
function sortForDisplay(list: Workspace[], currentId: string | undefined): Workspace[] {
  return [...list].sort((a, b) => {
    const aActive = a.id === currentId;
    const bActive = b.id === currentId;
    if (aActive !== bActive) return aActive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function WorkspaceSwitcher() {
  const lang = useStore(s => s.language);
  const workspaces = useWorkspaces();
  const current = useCurrentWorkspace();
  const switchWorkspace = useStore(s => s.switchWorkspace);
  const canEdit = useCanEdit();
  const roles = useWorkspaceRoles();

  const auth = useAuth();
  const { profile } = useProfile(auth.user?.id ?? null);

  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    setTimeout(() => document.addEventListener('mousedown', fn), 0);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const personal = sortForDisplay(workspaces.filter(w => w.kind === 'personal'), current?.id);
  const shared = sortForDisplay(workspaces.filter(w => w.kind !== 'personal'), current?.id);

  // Если пространств нет вовсе (например, локальный режим до init) — не рисуем.
  if (workspaces.length === 0) return null;

  const currentIsShared = current?.kind && current.kind !== 'personal';
  const CurrentIcon = currentIsShared ? Users : UserIcon;
  const label = current?.name ?? (lang === 'ru' ? 'Пространство' : 'Workspace');

  // Role-badge: только shared, только editor/viewer (owner/personal — без badge).
  const roleBadge = (role: WorkspaceRole | null) => {
    if (role === 'editor') {
      return (
        <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full bg-surface-alt text-[9px] uppercase tracking-wider text-muted" data-role="editor">
          <Pencil size={9} />
          {tr(lang, 'ws_switcher_role_editor')}
        </span>
      );
    }
    if (role === 'viewer') {
      return (
        <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full bg-surface-alt text-[9px] uppercase tracking-wider text-muted" data-role="viewer">
          <Eye size={9} />
          {tr(lang, 'ws_switcher_role_viewer')}
        </span>
      );
    }
    return null;
  };

  const renderItem = (w: Workspace, Icon: typeof UserIcon, withBadge: boolean) => (
    <button
      key={w.id}
      onClick={() => { switchWorkspace(w.id); setOpen(false); }}
      className={
        'w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-alt text-[13px] ' +
        (w.id === current?.id ? 'text-accent' : 'text-text')
      }
    >
      <Icon size={14} className="shrink-0" />
      <span className="flex-1 truncate">{w.name}</span>
      {withBadge && roleBadge(roles[w.id] ?? null)}
      {w.id === current?.id && <Check size={13} className="shrink-0" />}
    </button>
  );

  const tfid = profile?.public_user_id ?? 'TF-……';

  return (
    <div ref={ref} className="relative px-3 pb-2">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={tr(lang, 'ws_switch_aria')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border-soft hover:bg-surface-alt transition-colors"
      >
        <CurrentIcon size={14} className="text-muted shrink-0" />
        <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-left">{label}</span>
        <ChevronsUpDown size={13} className="text-muted shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-3 right-3 mt-1 bg-surface border border-border rounded-lg shadow-xl py-1 z-30 scale-in max-h-[50vh] overflow-y-auto"
        >
          {/* Личные — всегда есть минимум одно (инвариант Wave A). */}
          <div className="py-1" data-section="personal">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-faint">{tr(lang, 'ws_switcher_section_personal')}</div>
            {personal.map(w => renderItem(w, UserIcon, false))}
          </div>

          {/* Общие — секция рендерится всегда; при 0 shared показываем hint. */}
          <div className="py-1" data-section="shared">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-faint">{tr(lang, 'ws_switcher_section_shared')}</div>
            {shared.length > 0 ? (
              shared.map(w => renderItem(w, Users, true))
            ) : (
              <p className="px-3 py-1 text-[11px] leading-snug text-muted" data-testid="ws-shared-empty">
                {tr(lang, 'ws_switcher_shared_empty_hint').replace('{tfid}', tfid)}
              </p>
            )}
          </div>

          <div className="border-t border-border-soft mt-1 pt-1">
            <button
              type="button"
              onClick={() => { setOpen(false); setCreateOpen(true); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-text hover:bg-surface-alt"
            >
              <Plus size={14} className="shrink-0" />
              <span className="flex-1">{tr(lang, 'ws_create')}</span>
            </button>
            {/* Настройки пространства — только editor+ (viewer не видит). */}
            {canEdit && (
              <NavLink
                to="/workspace-settings"
                onClick={() => setOpen(false)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-muted hover:bg-surface-alt hover:text-text"
              >
                <Settings2 size={13} className="shrink-0" />
                <span className="flex-1">{tr(lang, 'ws_nav_settings')}</span>
              </NavLink>
            )}
          </div>
        </div>
      )}

      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
