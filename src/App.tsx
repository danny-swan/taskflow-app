/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 * https://polyformproject.org/licenses/noncommercial/1.0.0/
 */
import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import { ThemeProvider, ThemeWatermarks } from './themes/ThemeProvider';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ToastStack } from './components/Toast';
import { Onboarding } from './components/Onboarding';
import { OnboardingErrorBoundary } from './components/OnboardingErrorBoundary';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AuthScreen } from './components/AuthScreen';
import { PasswordResetModal } from './components/PasswordResetModal';
import { CommandPalette } from './components/CommandPalette';
import { PaywallGate } from './components/PaywallModal';
import { AccountSwitchGate } from './components/AccountSwitchGate';
import { useAuth, handleAuthCallback } from './lib/auth';
import { logEvent } from './lib/telemetry';
import { pingSupabaseKeepAlive } from './lib/supabase';
import { TasksPage } from './pages/Tasks';
// v0.8.6: AddTaskPage больше не подключается — заменена на NewTaskModal
// v0.8.12 (п. 24 code splitting): второстепенные вкладки грузим лениво —
// тяжёлые зависимости (recharts, xlsx, papaparse) уезжают в отдельные чанки
// и первая загрузка приложения становится заметно быстрее.
const DashboardPage = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const CalendarPage = lazy(() => import('./pages/Calendar').then(m => ({ default: m.CalendarPage })));
const StatsPage = lazy(() => import('./pages/Stats').then(m => ({ default: m.StatsPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then(m => ({ default: m.SettingsPage })));
const WorkspaceSettingsPage = lazy(() => import('./pages/WorkspaceSettings').then(m => ({ default: m.WorkspaceSettingsPage })));
const HelpPage = lazy(() => import('./pages/Help').then(m => ({ default: m.HelpPage })));
// v0.9.35-dev.6.4: страница подписки для оплаты через ЮKassa.
const CheckoutPage = lazy(() => import('./pages/Checkout').then(m => ({ default: m.CheckoutPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));

function App() {
  const ready = useStore(s => s.ready);
  const init = useStore(s => s.init);
  const statsEnabled = useStore(s => s.statsEnabled);
  const defaultTab = useStore(s => s.defaultTab);
  const autoUpdate = useStore(s => s.autoUpdateEnabled);
  const pushToast = useStore(s => s.pushToast);
  const lang = useStore(s => s.language);
  const checkAndRunAutoCleanupOnStartup = useStore(s => s.checkAndRunAutoCleanupOnStartup);
  const navigate = useNavigate();

  // v0.9.9: auth guard
  const auth = useAuth();

  // v0.9.14: флаг открытой модалки смены пароля (после recovery deep-link)
  const [showPasswordReset, setShowPasswordReset] = useState(false);

  // v0.9.29: глобальный Command Palette (Ctrl+K / Cmd+K)
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      // v0.9.30: e.code === 'KeyK' — горячая клавиша работает на любой раскладке (в т.ч. русской)
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  // v0.9.22: при старте приложения дёргаем Supabase (keep-alive),
  // чтобы в free-tier база не вставала на паузу после 7 дней неактивности.
  // fire-and-forget, ошибки глотаются внутри функции.
  useEffect(() => {
    pingSupabaseKeepAlive();
  }, []);

  // v0.9.11: слушаем deep link taskflow://auth/callback из Rust.
  // v0.9.14: если это recovery-link — открываем экран ввода нового пароля
  // вместо тоста «вы вошли».
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<string[]>('deep-link://auth-callback', async (event) => {
          const urls = event.payload ?? [];
          for (const u of urls) {
            // v0.9.35-dev.6.4: ветка для возврата с оплаты (taskflow://pay/success и taskflow://pay/fail).
            // Самая активация подписки идёт через webhook + Supabase realtime,
            // здесь только UX: показать toast и перевести на /settings.
            // v0.9.35-dev.6.4 (fix): добавлена ветка taskflow://checkout?tier=X —
            // кнопки с лендинга (yourtaskflow.app/#pricing) открывают /checkout в
            // приложении с предвыбранным тарифом (monthly/annual/lifetime).
            try {
              const parsed = new URL(u);
              if (parsed.protocol === 'taskflow:' && parsed.host === 'pay') {
                if (parsed.pathname === '/success') {
                  pushToast(lang === 'ru' ? 'Оплата прошла. Подписка активируется в течение минуты.' : 'Payment successful. Subscription will activate within a minute.');
                  navigate('/settings');
                } else if (parsed.pathname === '/fail') {
                  pushToast(lang === 'ru' ? 'Оплата отменена.' : 'Payment cancelled.');
                  navigate('/checkout');
                }
                continue;
              }
              if (parsed.protocol === 'taskflow:' && parsed.host === 'checkout') {
                // Нормализуем tier из query или pathname (на всякий).
                const tierRaw = parsed.searchParams.get('tier') ?? parsed.pathname.replace(/^\//, '');
                const tier = ['monthly', 'annual', 'lifetime'].includes(tierRaw) ? tierRaw : '';
                navigate(tier ? `/checkout?tier=${tier}` : '/checkout');
                continue;
              }
            } catch { /* не URL — падаем в авторизационную ветку */ }

            const result = await handleAuthCallback(u);
            if (result.ok) {
              if (result.type === 'recovery') {
                setShowPasswordReset(true);
              } else if (result.type === 'oauth') {
                pushToast(lang === 'ru' ? 'Вы вошли через Google' : 'Signed in with Google');
              } else if (result.type === 'signup') {
                pushToast(lang === 'ru' ? 'Email подтверждён' : 'Email confirmed');
              }
              break;
            }
          }
        });
      } catch {
        // Не Tauri (dev-web) — deep link не актуален.
      }
    })();
    return () => { if (unlisten) unlisten(); };
  }, [lang, pushToast, navigate]);

  useEffect(() => {
    init().catch(err => console.error('DB init failed', err));
    // © 2026 Daniil Lebedev (danny-swan) · PolyForm Noncommercial License 1.0.0
    // https://polyformproject.org/licenses/noncommercial/1.0.0/
    // eslint-disable-next-line no-console
    console.info('%cTaskFlow%c © 2026 Daniil Lebedev · PolyForm NC 1.0.0',
      'font-weight:bold', 'color:#888');
  }, [init]);

  // v0.9.28: catch-up автоочистки выполненных задач после инициализации БД.
  // Если сегодня прошёл выбранный день недели и last_run старее — тихо архивируем.
  // Показываем toast с Undo (5 сек), если что-то реально было архивировано.
  useEffect(() => {
    if (!ready) return;
    try {
      const archived = checkAndRunAutoCleanupOnStartup();
      if (archived > 0) {
        // v0.9.30: Статус теперь НЕ меняется автоочисткой (остаётся «Выполнено»).
        // Снапшот — id последних N архивных выполненных задач (archived=1) по updated_at.
        const s = useStore.getState();
        const doneStatusIds = new Set(
          s.statuses.filter(st => st.behavior === 'archive' && st.is_technical !== 1).map(st => st.id)
        );
        const recentlyArchived = s.tasks
          .filter(t => doneStatusIds.has(t.status_id) && t.archived === 1)
          .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
          .slice(0, archived)
          .map(t => t.id);
        const msg = lang === 'ru'
          ? `Автоочистка: ${archived} ${archived === 1 ? 'задача архивирована' : archived < 5 ? 'задачи архивированы' : 'задач архивировано'}`
          : `Auto-cleanup: ${archived} task${archived === 1 ? '' : 's'} archived`;
        pushToast(msg, {
          label: lang === 'ru' ? 'Отменить' : 'Undo',
          onClick: () => {
            const st = useStore.getState();
            // v0.9.30: возврат в Активные — снимаем archived=1 → 0 через updateTask.
            for (const id of recentlyArchived) {
              st.updateTask(id, { archived: 0 });
            }
            st.pushToast(lang === 'ru' ? 'Восстановлено' : 'Restored');
          },
        });
      }
    } catch (e) {
      console.warn('[autocleanup] startup check failed:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // v0.9.35-dev.4: инициализация авто-sync триггеров (on-init + on-focus + on-online).
  // В dev-сборке это no-op (см. sync/index → AUTO_SYNC_ENABLED).
  // Запускаем один раз после того, как БД инициализирована и есть сессия.
  useEffect(() => {
    if (!ready) return;
    if (!auth.session?.user) return;
    void import('./lib/sync').then(m => m.initAutoSync()).catch(err => {
      console.warn('[sync] initAutoSync failed:', err);
    });
  }, [ready, auth.session?.user]);

  // v0.9.9: телеметрия старта приложения (один раз на логин)
  useEffect(() => {
    if (auth.session?.user && ready) {
      logEvent('app_start');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.session?.user?.id, ready]);

  // v0.9.8: автопроверка обновлений через 5 сек после готовности — только если включено.
  // Не блокирует, не показывает диалог — просто тост с кнопкой «Обновить».
  useEffect(() => {
    if (!ready || !autoUpdate) return;
    const t = setTimeout(() => {
      import('./lib/updater').then(({ checkForUpdate }) => {
        checkForUpdate('current').then(info => {
          if (info.available) {
            pushToast(
              (lang === 'ru' ? 'Доступно обновление v' : 'Update available v') + info.newVersion,
              {
                label: lang === 'ru' ? 'Открыть' : 'Open',
                onClick: () => navigate('/settings'),
              }
            );
          }
        }).catch(() => { /* silent */ });
      });
    }, 5000);
    return () => clearTimeout(t);
  }, [ready, autoUpdate, pushToast, lang, navigate]);

  if (!ready || auth.loading) {
    return (
      <div className="h-full flex items-center justify-center bg-bg text-muted">
        <div className="text-center">
          <div className="font-display text-[18px] font-bold mb-1">TaskFlow</div>
          <div className="text-[12px]">{lang === 'ru' ? 'Загрузка...' : 'Loading...'}</div>
        </div>
      </div>
    );
  }

  // v0.9.21: E2E-байпас AuthScreen для Playwright.
  // Срабатывает только в dev-билде (import.meta.env.DEV=true) и
  // только когда URL содержит ?e2e=1. В prod-билде (production Vite и
  // Tauri release) этот блок вырезается tree-shaking'ом.
  const e2eBypass =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('e2e') === '1';

  // v0.9.9: если нет сессии или требуется перелогин — AuthScreen над всем UI
  if (!e2eBypass && (!auth.session || auth.needsReauth)) {
    return (
      <ThemeProvider>
        <AuthScreen reason={auth.needsReauth ? 'grace-expired' : 'first-run'} />
        <ToastStack />
      </ThemeProvider>
    );
  }

  const initError = (typeof window !== 'undefined' ? (window as any).__taskflow_init_error : null) as string | null;

  return (
    <ThemeProvider>
      <AppErrorBoundary>
      <div className="flex h-full bg-bg text-text">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden relative">
          <ThemeWatermarks />
          <RouteTopbar />
          <KeyboardShortcuts />
          {initError && (
            <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-400 text-[12px]">
              <strong>Ошибка инициализации БД:</strong> {initError}. Попробуйте Настройки → Хранилище → «Стереть все данные» или удалите файл %APPDATA%\TaskFlow\data.db.
            </div>
          )}
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to={`/${defaultTab}`} replace />} />
              <Route path="/tasks" element={<TasksPage />} />
              {/* v0.8.6: старый путь /add редиректит на /tasks — бывшие bookmark не приводят к 404 */}
              <Route path="/add" element={<Navigate to="/tasks" replace />} />
              {/* v0.9.35-dev.6: Calendar — платный раздел, обёрнут в PaywallGate. */}
              <Route path="/calendar" element={<PaywallGate><CalendarPage /></PaywallGate>} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/stats" element={statsEnabled ? <StatsPage /> : <Navigate to="/tasks" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/workspace-settings" element={<WorkspaceSettingsPage />} />
              <Route path="/help" element={<HelpPage />} />
              {/* v0.9.35-dev.6.4: Checkout — открытая страница оплаты подписки. */}
              <Route path="/checkout" element={<CheckoutPage />} />
              {/* v0.9.35-dev.6.6: Admin panel — guard проверяется внутри AdminPage */}
              <Route path="/admin" element={<AdminPage />} />
              <Route path="*" element={<Navigate to={`/${defaultTab}`} replace />} />
            </Routes>
          </Suspense>
        </main>
        <ToastStack />
        {/* v0.9.22: в e2e-режиме онбординг отключён — spotlight-overlay
            перехватывает клики Playwright и делает тесты флаки. */}
        {!e2eBypass && (
          <OnboardingErrorBoundary>
            <Onboarding />
          </OnboardingErrorBoundary>
        )}
        {showPasswordReset && (
          <PasswordResetModal onClose={() => setShowPasswordReset(false)} />
        )}
        {/* v0.9.35-dev.6.9.0: гейт смены аккаунта на одном устройстве.
            Сам решает, показываться ли (bound_user_id != session). Не в e2e. */}
        {!e2eBypass && <AccountSwitchGate />}
        {/* v0.9.29: Command Palette */}
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
      </AppErrorBoundary>
    </ThemeProvider>
  );
}

/** v0.8.12: лёгкий fallback для Suspense — виден на миллисекунды при первом
 * входе в ленивые вкладки. Намеренно без спиннера — не мелькает при быстрых переходах. */
function PageFallback() {
  return <div className="flex-1" />;
}

function RouteTopbar() {
  const loc = useLocation();
  // Tasks screen gets the date+time element.
  return <Topbar showDateTime={loc.pathname.startsWith('/tasks')} />;
}

function KeyboardShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName?.match(/INPUT|TEXTAREA|SELECT/) || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // v0.8.6: прямая цифровая навигация пересобрана — без /add
      // v0.9.4: в горячие клавиши добавлена новая вкладка «Календарь» (2), остальные сдвинуты.
      const map: Record<string, string> = {
        '1': '/tasks', '2': '/calendar', '3': '/dashboard',
        '4': '/stats', '5': '/settings', '6': '/help',
      };
      if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [navigate]);
  return null;
}

export default App;
