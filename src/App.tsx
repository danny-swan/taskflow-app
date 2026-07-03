/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 * https://polyformproject.org/licenses/noncommercial/1.0.0/
 */
import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import { ThemeProvider, ThemeWatermarks } from './themes/ThemeProvider';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ToastStack } from './components/Toast';
import { Onboarding } from './components/Onboarding';
import { TasksPage } from './pages/Tasks';
// v0.8.6: AddTaskPage больше не подключается — заменена на NewTaskModal
// v0.8.12 (п. 24 code splitting): второстепенные вкладки грузим лениво —
// тяжёлые зависимости (recharts, xlsx, papaparse) уезжают в отдельные чанки
// и первая загрузка приложения становится заметно быстрее.
const DashboardPage = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const CalendarPage = lazy(() => import('./pages/Calendar').then(m => ({ default: m.CalendarPage })));
const StatsPage = lazy(() => import('./pages/Stats').then(m => ({ default: m.StatsPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then(m => ({ default: m.SettingsPage })));
const HelpPage = lazy(() => import('./pages/Help').then(m => ({ default: m.HelpPage })));

function App() {
  const ready = useStore(s => s.ready);
  const init = useStore(s => s.init);
  const statsEnabled = useStore(s => s.statsEnabled);
  const defaultTab = useStore(s => s.defaultTab);
  const autoUpdate = useStore(s => s.autoUpdateEnabled);
  const pushToast = useStore(s => s.pushToast);
  const lang = useStore(s => s.language);
  const navigate = useNavigate();

  useEffect(() => {
    init().catch(err => console.error('DB init failed', err));
    // © 2026 Daniil Lebedev (danny-swan) · PolyForm Noncommercial License 1.0.0
    // https://polyformproject.org/licenses/noncommercial/1.0.0/
    // eslint-disable-next-line no-console
    console.info('%cTaskFlow%c © 2026 Daniil Lebedev · PolyForm NC 1.0.0',
      'font-weight:bold', 'color:#888');
  }, [init]);

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

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center bg-bg text-muted">
        <div className="text-center">
          <div className="font-display text-[18px] font-bold mb-1">TaskFlow</div>
          <div className="text-[12px]">Загрузка...</div>
        </div>
      </div>
    );
  }

  const initError = (typeof window !== 'undefined' ? (window as any).__taskflow_init_error : null) as string | null;

  return (
    <ThemeProvider>
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
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/stats" element={statsEnabled ? <StatsPage /> : <Navigate to="/tasks" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="*" element={<Navigate to={`/${defaultTab}`} replace />} />
            </Routes>
          </Suspense>
        </main>
        <ToastStack />
        <Onboarding />
      </div>
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
