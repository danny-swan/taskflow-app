/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.17 — Защитная обёртка для <Onboarding />.
 *
 * Проблема: если рендер Onboarding падает с исключением (например, из-за race
 * condition, изменения DOM во время анимации или бага в позиционировании),
 * React отбрасывает всё дерево приложения и показывает белый экран. Дальше
 * при перезапуске цикл повторяется — потому что флаг «онбординг пройден»
 * ставится только в close(), а close() до крэша не доходит.
 *
 * Решение: React error boundary вокруг Onboarding. При любом исключении
 * (1) помечает тур как пройденный, чтобы приложение больше не запускало
 *     онбординг при старте — цикл разомкнут навсегда;
 * (2) возвращает null — Sidebar/Topbar/задачи остаются на экране, приложение
 *     полностью функционально;
 * (3) логирует ошибку в консоль (F12 → Console), чтобы в будущем найти
 *     точную причину, если она снова проявится.
 *
 * Sidenote: обёртка применяется только к Onboarding, а не ко всему App —
 * ошибки в других частях приложения по-прежнему обрабатываются React как
 * обычно, чтобы мы их видели и чинили.
 */
import { Component, ErrorInfo, ReactNode } from 'react';
import { markOnboardingSeen } from './Onboarding';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class OnboardingErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(_error: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[TaskFlow] Onboarding crashed, tour disabled to unblock app:', error, info);
    // Разблокируем приложение навсегда — тур больше не запустится автоматически.
    try {
      markOnboardingSeen();
    } catch {
      /* silent */
    }
  }

  render() {
    if (this.state.hasError) {
      // Тихо возвращаем null — приложение продолжает работать без онбординга.
      return null;
    }
    return this.props.children;
  }
}
