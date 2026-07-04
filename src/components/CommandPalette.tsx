/*
 * TaskFlow — Command Palette
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.29: глобальная палитра команд (Ctrl+K / Cmd+K).
 * Три категории результатов:
 *   1) Навигация — переходы между страницами
 *   2) Задачи — fuzzy-match по title из useStore.tasks
 *   3) Действия — быстрые операции (новая задача, смена темы, экспорт, вид)
 *
 * Клавиатура: ↑/↓ — навигация, Enter — выбор, Esc — закрыть.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, ListTodo, Calendar, LayoutDashboard, BarChart3, Settings as SettingsIcon,
  HelpCircle, Plus, Sun, LayoutList,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';

interface Item {
  id: string;
  group: 'nav' | 'tasks' | 'actions';
  label: string;
  hint?: string;
  icon: any;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lang = useStore(s => s.language);
  const tasks = useStore(s => s.tasks);
  const statuses = useStore(s => s.statuses);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const tasksView = useStore(s => s.tasksView);
  const setTasksView = useStore(s => s.setTasksView);
  const statsEnabled = useStore(s => s.statsEnabled);
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Сброс состояния при открытии.
  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      // small delay: даём модалке отрендериться перед focus
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // v0.9.29: собираем базовые пункты (навигация + действия) — динамически, чтобы
  // язык/тема/tasksView отражались в подписях.
  const baseItems: Item[] = useMemo(() => {
    const items: Item[] = [
      // ── Навигация ──
      { id: 'nav-tasks', group: 'nav', label: tr(lang, 'nav_tasks'), icon: ListTodo, run: () => navigate('/tasks') },
      { id: 'nav-calendar', group: 'nav', label: tr(lang, 'nav_calendar'), icon: Calendar, run: () => navigate('/calendar') },
      { id: 'nav-dashboard', group: 'nav', label: tr(lang, 'nav_dashboard'), icon: LayoutDashboard, run: () => navigate('/dashboard') },
    ];
    if (statsEnabled) {
      items.push({ id: 'nav-stats', group: 'nav', label: tr(lang, 'nav_stats'), icon: BarChart3, run: () => navigate('/stats') });
    }
    items.push(
      { id: 'nav-settings', group: 'nav', label: tr(lang, 'nav_settings'), icon: SettingsIcon, run: () => navigate('/settings') },
      { id: 'nav-help', group: 'nav', label: tr(lang, 'nav_help'), icon: HelpCircle, run: () => navigate('/help') },
    );

    // ── Действия ──
    items.push(
      {
        id: 'act-new-task',
        group: 'actions',
        label: tr(lang, 'action_new_task'),
        hint: 'N',
        icon: Plus,
        run: () => {
          navigate('/tasks');
          // ждём кадр перед dispatch — Tasks.tsx должен успеть смонтировать listener
          requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('taskflow:new-task')));
        },
      },
      {
        id: 'act-toggle-theme',
        group: 'actions',
        label: tr(lang, 'action_toggle_theme'),
        icon: Sun,
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'act-toggle-view',
        group: 'actions',
        label: tr(lang, 'action_toggle_view'),
        icon: LayoutList,
        run: () => {
          setTasksView(tasksView === 'list' ? 'kanban' : 'list');
          navigate('/tasks');
        },
      },
      {
        id: 'act-export-json',
        group: 'actions',
        label: tr(lang, 'action_export_json'),
        icon: SettingsIcon,
        run: () => navigate('/settings?sub=io'),
      },
    );
    return items;
  }, [lang, navigate, setTheme, theme, setTasksView, tasksView, statsEnabled]);

  // Список видимых задач (не в технических статусах). Fuzzy-match простой substring.
  const taskItems: Item[] = useMemo(() => {
    if (!q.trim()) return [];
    const query = q.trim().toLowerCase();
    const techIds = new Set(statuses.filter(s => s.is_technical === 1).map(s => s.id));
    const matched = tasks
      .filter(t => !techIds.has(t.status_id) && t.title.toLowerCase().includes(query))
      .slice(0, 8); // до 8 задач — не забиваем палитру
    return matched.map(t => ({
      id: `task-${t.id}`,
      group: 'tasks' as const,
      label: t.title,
      icon: ListTodo,
      run: () => {
        // Переход в /tasks и подсветка — пока просто навигация; поиск в самой странице
        // задач получит фокус через существующий hotkey. Достаточно для v0.9.29.
        navigate('/tasks');
      },
    }));
  }, [q, tasks, statuses, navigate]);

  // Финальный отфильтрованный список: если пусто — показываем всё базовое.
  const filtered: Item[] = useMemo(() => {
    if (!q.trim()) return baseItems;
    const query = q.trim().toLowerCase();
    const baseMatched = baseItems.filter(it => it.label.toLowerCase().includes(query));
    return [...baseMatched, ...taskItems];
  }, [q, baseItems, taskItems]);

  // Reset active index when list changes
  useEffect(() => { setIdx(0); }, [filtered.length]);

  // Прокрутка активного элемента в видимую зону
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  // Global keydown
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const it = filtered[idx];
        if (it) { it.run(); onClose(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, idx, filtered, onClose]);

  if (!open) return null;

  // Группируем для рендера — сохраняем порядок появления групп по filtered
  const groups: { key: Item['group']; title: string; items: { it: Item; globalIdx: number }[] }[] = [];
  const titleFor: Record<Item['group'], string> = {
    nav: tr(lang, 'palette_group_nav'),
    tasks: tr(lang, 'palette_group_tasks'),
    actions: tr(lang, 'palette_group_actions'),
  };
  filtered.forEach((it, i) => {
    let g = groups.find(g => g.key === it.group);
    if (!g) {
      g = { key: it.group, title: titleFor[it.group], items: [] };
      groups.push(g);
    }
    g.items.push({ it, globalIdx: i });
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div
        className="w-full max-w-xl mx-4 rounded-2xl bg-surface border border-border shadow-2xl overflow-hidden scale-in"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-border-soft">
          <Search size={16} className="text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={tr(lang, 'palette_placeholder')}
            className="flex-1 h-12 bg-transparent text-[14px] text-text placeholder:text-faint focus:outline-none"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="hidden sm:inline text-[10px] text-muted border border-border-soft rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-muted">
              {tr(lang, 'palette_no_results')}
            </div>
          )}
          {groups.map(group => (
            <div key={group.key} className="mb-1">
              <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wide text-faint font-medium">
                {group.title}
              </div>
              {group.items.map(({ it, globalIdx }) => {
                const Ic = it.icon;
                const active = globalIdx === idx;
                return (
                  <button
                    key={it.id}
                    data-idx={globalIdx}
                    type="button"
                    onMouseEnter={() => setIdx(globalIdx)}
                    onClick={() => { it.run(); onClose(); }}
                    className={
                      'w-full flex items-center gap-3 px-4 py-2 text-left text-[13px] transition-colors ' +
                      (active ? 'bg-accent-soft text-text' : 'text-text hover:bg-surface-alt')
                    }
                  >
                    <Ic size={14} className={active ? 'text-accent' : 'text-muted'} />
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.hint && (
                      <kbd className="text-[10px] text-muted border border-border-soft rounded px-1.5 py-0.5">
                        {it.hint}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border-soft bg-bg text-[10px] text-muted">
          <div className="flex items-center gap-3">
            <span>↑↓ {tr(lang, 'palette_hint_navigate')}</span>
            <span>⏎ {tr(lang, 'palette_hint_select')}</span>
          </div>
          <span>{tr(lang, 'palette_hint_close')}</span>
        </div>
      </div>
    </div>
  );
}
