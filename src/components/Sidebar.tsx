import { NavLink, useNavigate } from 'react-router-dom';
import { useStore, ThemeName } from '../store/useStore';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { MyInvitesSection } from './MyInvitesSection';
import { tr } from '../lib/i18n';
import { usePendingSyncCount, shouldHidePendingChip } from '../lib/pendingSync';
import { isWorkspaceLimitError } from '../lib/workspaceLimits';
import {
  ListChecks, LayoutDashboard, BarChart3, Settings, HelpCircle,
  Sun, Moon, Sparkles, Leaf, Palette, ChevronDown, CalendarDays, Cloud, X, Clock,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useEntitlement, daysLeftInTrial } from '../lib/entitlements';

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
    { key: 'custom', label: tr(lang, 'theme_custom'), icon: Palette },
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

      {/* Wave A (PR-3): переключатель пространств. */}
      <WorkspaceSwitcher />

      {/* Wave B (PR-b-04): входящие приглашения в общие пространства. */}
      <MyInvitesSection />

      {/* v0.9.35-dev.6: баннер статуса подписки (trial / free-CTA / expired). */}
      <SubscriptionBanner />

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

      {/* v0.9.35-dev.3: pending sync indicator.
          Виден в dev-сборке всегда (для отладки sync-слоя), в prod — только если count > 0.
          В dev.4 к этому чипу будет привязан realtime-статус push'а.
          Размещён внизу (под nav), чтобы появление/исчезновение чипа не сдвигало пункты навигации. */}
      <PendingSyncChip />

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
 * v0.9.35-dev.3: dev-only чип с количеством записей в sync_outbox.
 * В prod-сборке показывается только если что-то реально ждёт push'а —
 * в dev.4 тут будет realtime-индикатор (идёт отправка / ошибка / всё синк).
 */
function PendingSyncChip() {
  const lang = useStore(s => s.language);
  const count = usePendingSyncCount();
  const isDev = import.meta.env.DEV;

  // v0.9.35-dev.4: подписываемся на sync-состояние через lazy import (чтобы
  // чанк sync/index не вошёл в initial bundle Sidebar'а).
  const [syncStatus, setSyncStatus] = useState<'idle' | 'pulling' | 'pushing' | 'synced' | 'error' | 'skipped' | 'paywalled'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let mounted = true;
    void import('../lib/sync').then(m => {
      if (!mounted) return;
      const initial = m.getSyncState();
      setSyncStatus(initial.status);
      setSyncError(initial.lastError);
      unsubscribe = m.subscribeSyncState(s => {
        setSyncStatus(s.status);
        setSyncError(s.lastError);
      });
    }).catch(() => {});
    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Скрываем chip, когда sync недоступен (paywalled/нет сессии) или, для
  // Pro/trial, когда в prod ничего не происходит (в dev показываем всегда).
  const isBusy = syncStatus === 'pulling' || syncStatus === 'pushing';
  const isError = syncStatus === 'error';
  if (shouldHidePendingChip(syncStatus, count, isDev)) return null;

  // Формируем label + цвет.
  let label: string;
  let iconColor = 'text-faint';
  let valueColor = 'text-faint tabular';
  if (isBusy) {
    label = lang === 'ru'
      ? (syncStatus === 'pulling' ? 'скачивание' : 'отправка')
      : syncStatus;
    iconColor = 'text-accent animate-pulse';
    valueColor = 'text-accent font-semibold tabular';
  } else if (isError) {
    label = lang === 'ru' ? 'ошибка sync' : 'sync error';
    iconColor = 'text-[var(--error,#c33)]';
    valueColor = 'text-[var(--error,#c33)] font-semibold tabular';
  } else if (syncStatus === 'synced' && count === 0) {
    label = lang === 'ru' ? 'синхронизировано' : 'synced';
    iconColor = 'text-[var(--success,#7a3)]';
    valueColor = 'text-faint tabular';
  } else {
    label = lang === 'ru' ? 'pending sync' : 'pending sync';
    iconColor = count > 0 ? 'text-accent' : 'text-faint';
    valueColor = count > 0 ? 'text-accent font-semibold tabular' : 'text-faint tabular';
  }

  // Fallback-апселл при race: если серверный триггер отклонил создание
  // пространства (workspace_limit_exceeded), показываем тарифное сообщение,
  // а не сырой текст ошибки sync.
  const isLimitError = isError && isWorkspaceLimitError(syncError);
  const errorText = isLimitError
    ? tr(lang, 'ws_limit_sync_error')
    : (syncError ?? (lang === 'ru' ? 'неизвестно' : 'unknown'));
  const title = lang === 'ru'
    ? (isError ? `Ошибка: ${errorText}` : `В очереди: ${count}, статус: ${syncStatus}`)
    : (isError ? `Error: ${errorText}` : `Queued: ${count}, status: ${syncStatus}`);

  return (
    <div
      className="mx-3 mb-2 mt-1 px-2 py-1 rounded-md border border-border-soft bg-[var(--surface-alt)]/40 flex items-center gap-1.5 text-[10px] text-muted mono tracking-wide"
      title={title}
    >
      <Cloud size={11} className={iconColor} />
      <span>{label}:</span>
      <span className={valueColor}>{isBusy ? '…' : count}</span>
    </div>
  );
}

/**
 * v0.9.35-dev.6 — баннер о статусе подписки.
 *
 * Показывает:
 *   - Trial активен: «Trial · осталось N дн.» (кликабельно).
 *   - Trial истёк: «Trial закончился · оформить».
 *   - Free + не брал trial: софткая CTA «Активировать 14 дней Pro» (dismissable).
 *   - Pro / Lifetime: ничего (чистый sidebar).
 *
 * Dismiss хранится в localStorage. Сбрасывается при смене plan (если даже
 * был dismissed, после trial истечения показать опять — пользователь
 * должен увидеть). Делаем через stamp по effectivePlan.
 */
function SubscriptionBanner() {
  const lang = useStore(s => s.language);
  const navigate = useNavigate();
  const auth = useAuth();
  const { entitlement } = useEntitlement(
    auth.user?.id ?? null,
    auth.user?.email ?? null,
  );

  // Dismiss stamp: какой effectivePlan+state юзер уже «погасил».
  const dismissKey = 'tf.subscription_banner_dismissed_v1';
  const [dismissedStamp, setDismissedStamp] = useState<string | null>(() => {
    try { return localStorage.getItem(dismissKey); } catch { return null; }
  });

  // Pro/Lifetime — ничего не показываем.
  if (entitlement.effectivePlan === 'pro' || entitlement.effectivePlan === 'lifetime') {
    return null;
  }
  // Нет сессии — не засоряем UI (AuthScreen всё равно показывается).
  if (!auth.user) return null;

  const trialExpired =
    entitlement.rawPlan === 'trial' && entitlement.effectivePlan === 'free';

  // Стамп для dismiss.
  const stamp = entitlement.isTrialActive
    ? `trial-active-${daysLeftInTrial(entitlement)}`
    : trialExpired
      ? 'trial-expired'
      : 'free-cta';

  // Trial-коунтдаун и trial-expired — НЕ dismissable (важно показывать).
  // Только free-CTA можно погасить.
  const canDismiss = !entitlement.isTrialActive && !trialExpired;
  if (canDismiss && dismissedStamp === stamp) return null;

  let label: string;
  let cta: string;
  let variant: 'trial' | 'expired' | 'cta' = 'cta';

  if (entitlement.isTrialActive) {
    const n = daysLeftInTrial(entitlement);
    label = lang === 'ru' ? `Trial · осталось ${n} дн.` : `Trial · ${n} days left`;
    cta = lang === 'ru' ? 'Управление' : 'Manage';
    variant = 'trial';
  } else if (trialExpired) {
    label = lang === 'ru' ? 'Trial закончился' : 'Trial ended';
    cta = lang === 'ru' ? 'Оформить' : 'Subscribe';
    variant = 'expired';
  } else {
    // Free + trial_used=false: предлагаем 14 дней.
    // Если trial уже был (trial_used=true) — показываем мягкую CTA на Pro.
    if (entitlement.trialUsed) {
      label = lang === 'ru' ? 'Открыть Pro' : 'Unlock Pro';
    } else {
      label = lang === 'ru' ? '14 дней Pro бесплатно' : '14 days Pro free';
    }
    cta = lang === 'ru' ? 'Подробнее' : 'Learn more';
  }

  const bg =
    variant === 'expired'
      ? 'color-mix(in oklab, var(--error, #c33) 12%, transparent)'
      : 'color-mix(in oklab, var(--accent, #01696F) 12%, transparent)';
  const borderColor =
    variant === 'expired'
      ? 'color-mix(in oklab, var(--error, #c33) 35%, transparent)'
      : 'color-mix(in oklab, var(--accent, #01696F) 35%, transparent)';

  return (
    <div
      className="mx-3 mb-2 mt-1 px-2.5 py-2 rounded-md flex items-start gap-2 text-[11px]"
      style={{ background: bg, borderColor, borderWidth: 1, borderStyle: 'solid' }}
      data-testid="subscription-banner"
      data-variant={variant}
    >
      {variant === 'expired' ? (
        <Clock size={12} className="text-[var(--error,#c33)] mt-[2px] flex-shrink-0" />
      ) : (
        <Sparkles size={12} className="text-accent mt-[2px] flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-text font-medium leading-tight">{label}</div>
        <button
          onClick={() => navigate('/settings#subscription')}
          className="mt-1 text-[10px] text-accent hover:underline"
        >
          {cta} →
        </button>
      </div>
      {canDismiss && (
        <button
          onClick={() => {
            try { localStorage.setItem(dismissKey, stamp); } catch { /* silent */ }
            setDismissedStamp(stamp);
          }}
          className="text-muted hover:text-text p-0.5 rounded flex-shrink-0"
          aria-label={lang === 'ru' ? 'Скрыть' : 'Dismiss'}
        >
          <X size={10} />
        </button>
      )}
    </div>
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
