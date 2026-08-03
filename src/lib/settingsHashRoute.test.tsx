import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { parseSettingsSection } from './settingsSections';

/**
 * F39 (ADR 0030) — ДОКАЗАТЕЛЬСТВО КОРНЯ, а не только проверка фикса.
 *
 * Приложение работает под HashRouter (`src/main.tsx`). Этот тест фиксирует
 * фактическое поведение: после `navigate('/settings#subscription')`
 *   • `window.location.hash` === '#/settings#subscription' — поэтому прежняя
 *     проверка `window.location.hash === '#subscription'` в Settings.tsx
 *     не срабатывала НИКОГДА (клик по trial-баннеру открывал «Основные»);
 *   • `useLocation().hash` === '#subscription' — правильный источник, который
 *     и разбирает `parseSettingsSection`.
 */
function Probe() {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <button onClick={() => navigate('/settings#subscription')}>go-sub</button>
      <button onClick={() => navigate('/settings#updates')}>go-upd</button>
      <div data-testid="router-hash">{loc.hash}</div>
      <div data-testid="window-hash">{typeof window !== 'undefined' ? window.location.hash : ''}</div>
      <div data-testid="parsed">{String(parseSettingsSection(loc.hash))}</div>
    </div>
  );
}

function App() {
  return (
    <HashRouter>
      <Probe />
      <Routes>
        <Route path="/settings" element={<div>settings-page</div>} />
        <Route path="*" element={<div>other-page</div>} />
      </Routes>
    </HashRouter>
  );
}

describe('навигация в секцию настроек под HashRouter', () => {
  it('window.location.hash содержит ВЕСЬ маршрут, а секцию отдаёт только useLocation().hash', () => {
    render(<App />);
    act(() => {
      screen.getByText('go-sub').click();
    });
    expect(screen.getByText('settings-page')).toBeTruthy();
    // Корень бага: полный хэш — это маршрут, он никогда не равен '#subscription'.
    expect(screen.getByTestId('window-hash').textContent).toBe('#/settings#subscription');
    expect(screen.getByTestId('window-hash').textContent).not.toBe('#subscription');
    // Правильный источник + разбор.
    expect(screen.getByTestId('router-hash').textContent).toBe('#subscription');
    expect(screen.getByTestId('parsed').textContent).toBe('subscription');
  });

  it('повторная навигация на другую секцию, когда страница уже открыта, меняет location.hash', () => {
    render(<App />);
    act(() => {
      screen.getByText('go-sub').click();
    });
    expect(screen.getByTestId('parsed').textContent).toBe('subscription');
    act(() => {
      screen.getByText('go-upd').click();
    });
    expect(screen.getByTestId('router-hash').textContent).toBe('#updates');
    expect(screen.getByTestId('parsed').textContent).toBe('updates');
  });
});
