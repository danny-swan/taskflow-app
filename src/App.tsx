import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import { ThemeProvider, ThemeWatermarks } from './themes/ThemeProvider';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { ToastStack } from './components/Toast';
import { TasksPage } from './pages/Tasks';
import { AddTaskPage } from './pages/AddTask';
import { DashboardPage } from './pages/Dashboard';
import { StatsPage } from './pages/Stats';
import { SettingsPage } from './pages/Settings';
import { HelpPage } from './pages/Help';

function App() {
  const ready = useStore(s => s.ready);
  const init = useStore(s => s.init);
  const statsEnabled = useStore(s => s.statsEnabled);
  const defaultTab = useStore(s => s.defaultTab);

  useEffect(() => {
    init().catch(err => console.error('DB init failed', err));
  }, [init]);

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
          <Routes>
            <Route path="/" element={<Navigate to={`/${defaultTab}`} replace />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/add" element={<AddTaskPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/stats" element={statsEnabled ? <StatsPage /> : <Navigate to="/tasks" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="*" element={<Navigate to={`/${defaultTab}`} replace />} />
          </Routes>
        </main>
        <ToastStack />
      </div>
    </ThemeProvider>
  );
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
      const map: Record<string, string> = {
        '1': '/tasks', '2': '/add', '3': '/dashboard',
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
