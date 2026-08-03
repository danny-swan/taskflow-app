import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDefaultTabNavigation } from './useDefaultTabNavigation';

/**
 * F38 (ADR 0030): при входе в аккаунт и при смене пространства активная
 * вкладка = «Вкладка по умолчанию» из настроек.
 */
type Props = {
  ready: boolean;
  userId: string | null;
  workspaceId: string | null;
  defaultTab: string;
};

describe('useDefaultTabNavigation', () => {
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigate = vi.fn();
  });

  const setup = (args: {
    ready?: boolean;
    userId?: string | null;
    workspaceId?: string | null;
    defaultTab?: string;
  }) =>
    renderHook(
      (p: Props) => useDefaultTabNavigation({ ...p, navigate }),
      {
        initialProps: {
          ready: args.ready ?? true,
          userId: args.userId ?? 'u1',
          workspaceId: args.workspaceId ?? 'ws1',
          defaultTab: args.defaultTab ?? 'tasks',
        } as Props,
      },
    );

  it('первый проход ничего не навигирует (маршрут при старте уже корректен, deep-link не перебиваем)', () => {
    setup({});
    expect(navigate).not.toHaveBeenCalled();
  });

  it('смена пространства → переход на дефолтную вкладку', () => {
    const { rerender } = setup({ defaultTab: 'tasks' });
    rerender({ ready: true, userId: 'u1', workspaceId: 'ws2', defaultTab: 'tasks' });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/tasks', { replace: true });
  });

  it('дефолтная вкладка берётся из настроек, а не хардкодится', () => {
    const { rerender } = setup({ defaultTab: 'dashboard' });
    rerender({ ready: true, userId: 'u1', workspaceId: 'ws2', defaultTab: 'dashboard' });
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('выход и вход в ТОТ ЖЕ аккаунт (маршрут остался #/settings) → дефолтная вкладка', () => {
    const { rerender } = setup({ userId: 'u1' });
    // Выход: сессии нет, показывается AuthScreen — навигация не нужна.
    rerender({ ready: true, userId: null, workspaceId: null, defaultTab: 'tasks' });
    expect(navigate).not.toHaveBeenCalled();
    // Вход обратно.
    rerender({ ready: true, userId: 'u1', workspaceId: 'ws1', defaultTab: 'tasks' });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/tasks', { replace: true });
  });

  it('вход в ДРУГОЙ аккаунт → дефолтная вкладка (одним переходом, а не дважды)', () => {
    const { rerender } = setup({ userId: 'u1', workspaceId: 'ws1' });
    rerender({ ready: true, userId: 'u2', workspaceId: 'ws9', defaultTab: 'tasks' });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/tasks', { replace: true });
  });

  it('пока БД не готова — не навигируем и не запоминаем состояние', () => {
    const { rerender } = setup({ ready: false, userId: 'u1', workspaceId: 'ws1' });
    rerender({ ready: false, userId: 'u1', workspaceId: 'ws2', defaultTab: 'tasks' });
    expect(navigate).not.toHaveBeenCalled();
    // Первый готовый проход — тоже без навигации (это «старт»).
    rerender({ ready: true, userId: 'u1', workspaceId: 'ws2', defaultTab: 'tasks' });
    expect(navigate).not.toHaveBeenCalled();
    // А вот следующая смена ws уже работает.
    rerender({ ready: true, userId: 'u1', workspaceId: 'ws3', defaultTab: 'tasks' });
    expect(navigate).toHaveBeenCalledWith('/tasks', { replace: true });
  });

  it('пространство ещё не выбрано (null) при живой сессии → без навигации', () => {
    const { rerender } = setup({ userId: 'u1', workspaceId: 'ws1' });
    rerender({ ready: true, userId: 'u1', workspaceId: null, defaultTab: 'tasks' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('повторные рендеры без изменений не навигируют (нельзя выкидывать из открытой вкладки)', () => {
    const { rerender } = setup({ userId: 'u1', workspaceId: 'ws1' });
    rerender({ ready: true, userId: 'u1', workspaceId: 'ws1', defaultTab: 'tasks' });
    rerender({ ready: true, userId: 'u1', workspaceId: 'ws1', defaultTab: 'tasks' });
    expect(navigate).not.toHaveBeenCalled();
  });
});
