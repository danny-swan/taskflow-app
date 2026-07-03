import { NavLink } from 'react-router-dom';
import { useStore, ThemeName } from '../store/useStore';
import { tr } from '../lib/i18n';
import {
  ListChecks, Plus, LayoutDashboard, BarChart3, Settings, HelpCircle,
  Sun, Moon, Sparkles, Leaf, ChevronDown, CalendarDays,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export function Sidebar() {
  const lang = useStore(s => s.language);
  const setLang = useStore(s => s.setLanguage);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  const statsEnabled = useStore(s => s.statsEnabled);

  // v0.8.6: «Добавить» убран из сайдбара — теперь всё через модалку «+ Новая задача» на вкладке Оадачи
  const items = [
    { to: '/tasks', label: tr(lang, 'nav_tasks'), icon: ListChecks, key: 'tasks' },
    { to: '/calendar', label: tr(lang, 'nav_calendar'), icon: CalendarDays, key: 'calendar' },
    { to: '/dashboard', label: tr(lang, 'nav_dashboard'), icon: LayoutDashboard, key: 'dashboard' },
    { to: '/stats', label: tr(lang, 'nav_stats'), icon: BarChart3, key: 'stats', hidden: !statsEnabled },
    { to: '/settings', label: tr(lang, 'nav_settings'), icon: Settings, key: 'settings' },
    { to: '/help', label: tr(lang, 'nav_help'), icon: HelpCircle, key: 'help' },
  ];

  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!themeOpen) return;
    const fn = (e: MouseEvent) => { if (themeRef.current && !themeRef.current.contains(e.target as Node)) setThemeOpen(false); };
    setTimeout(() => document.addEventListener('mousedown', fn), 0);
    return () => document.removeEventListener('mousedown', fn);
  }, [themeOpen]);

  const themeOptions: { key: ThemeName; label: string; icon: any }[] = [
    { key: 'light', label: tr(lang, 'theme_light'), icon: Sun },
    { key: 'dark', label: tr(lang, 'theme_dark'), icon: Moon },
    { key: 'akatsuki', label: tr(lang, 'theme_akatsuki'), icon: Sparkles },
    { key: 'konoha', label: tr(lang, 'theme_konoha'), icon: Leaf },
  ];
  const ThemeIcon = themeOptions.find(t => t.key === theme)?.icon || Sun;

  return (
    <aside
      className="flex flex-col shrink-0 border-r border-border-soft"
      style={{ width: 220, background: 'var(--surface)' }}
      data-onboarding="sidebar"
    >
      {/* Brand */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center">
          <TaskFlowMark />
        </div>
        <div className="text-[11px] text-muted mt-0.5 ml-[2px] tracking-wide">{tr(lang, 'brand_sub')}</div>
        <div className="text-[10px] text-faint mt-0.5 ml-[2px] tracking-wider tabular mono">v{__APP_VERSION__}</div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 overflow-y-auto">
        {items.filter(i => !i.hidden).map(it => {
          const Icon = it.icon;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              data-onboarding={`nav-${it.key}`}
              className={({ isActive }) =>
                'flex items-center gap-2.5 px-3 py-1.5 mb-0.5 rounded-md text-[13px] transition-colors ' +
                (isActive
                  ? 'bg-accent-soft text-accent font-medium'
                  : 'text-text hover:bg-surface-alt')
              }
            >
              <Icon size={15} />
              <span>{it.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Footer: language + theme */}
      <div className="p-2.5 border-t border-border-soft flex items-center gap-2 bg-[var(--surface)]">
        {/* v0.8.11: визуальный тоггл RU/EN — активный язык подсвечивается акцентным фоном.
            Работает как «рычаг» — визуально ясно, какой язык сейчас выбран. */}
        <div
          role="group"
          aria-label={lang === 'ru' ? 'Язык' : 'Language'}
          className="flex-1 flex items-center rounded-md border border-border-soft overflow-hidden p-[2px] gap-[2px] bg-[var(--surface-alt)]/40"
        >
          <button
            type="button"
            onClick={() => setLang('ru')}
            aria-pressed={lang === 'ru'}
            className={
              'flex-1 px-2 py-1 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ' +
              (lang === 'ru'
                ? 'bg-accent-soft text-accent font-semibold'
                : 'text-muted hover:text-text hover:bg-surface-alt')
            }
          >
            RU
          </button>
          <button
            type="button"
            onClick={() => setLang('en')}
            aria-pressed={lang === 'en'}
            className={
              'flex-1 px-2 py-1 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ' +
              (lang === 'en'
                ? 'bg-accent-soft text-accent font-semibold'
                : 'text-muted hover:text-text hover:bg-surface-alt')
            }
          >
            EN
          </button>
        </div>
        <div ref={themeRef} className="relative">
          <button
            onClick={() => setThemeOpen(o => !o)}
            className="px-2 py-1.5 rounded-md hover:bg-surface-alt border border-border-soft flex items-center gap-1"
            aria-label="Theme"
          >
            <ThemeIcon size={14} />
            <ChevronDown size={12} />
          </button>
          {themeOpen && (
            <div className="absolute bottom-full mb-1 right-0 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[160px] z-30 scale-in">
              {themeOptions.map(o => {
                const Ic = o.icon;
                return (
                  <button
                    key={o.key}
                    onClick={() => { setTheme(o.key); setThemeOpen(false); }}
                    className={'w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-alt text-[13px] ' +
                      (theme === o.key ? 'text-accent' : '')}
                  >
                    <Ic size={14} />
                    <span>{o.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

/**
 * TaskFlow — simple, clean logo.
 * Rounded square filled with the theme accent, white check inside.
 * "TaskFlow" wordmark next to it in the regular text color.
 */
function TaskFlowMark() {
  return (
    <div className="flex items-center gap-2 select-none" aria-label="TaskFlow">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--accent)" />
        <path
          d="M6.5 12.4 L10 15.8 L17.5 8.4"
          stroke="#ffffff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span
        className="font-display font-bold tracking-tight"
        style={{ fontSize: 16, letterSpacing: '-0.02em', color: 'var(--text)' }}
      >
        TaskFlow
      </span>
    </div>
  );
}
