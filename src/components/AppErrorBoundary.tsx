// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// AppErrorBoundary — глобальная защитная обёртка вокруг основного layout.
//
// Проблема (Bug C): если рендер любой страницы/модалки падает с исключением
// (например, dangling status_id/tag_id после смены ws, рассинхрон данных),
// React отбрасывает всё дерево и показывает пустой белый экран без единой
// подсказки — пользователь застревает. В отличие от OnboardingErrorBoundary
// (которая гасит только тур и возвращает null), здесь нужен видимый экран
// восстановления с кнопкой перезагрузки, чтобы разомкнуть тупик.
import { Component, ErrorInfo, ReactNode } from 'react';
import { useStore } from '../store/useStore';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(_error: Error): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[TaskFlow] App crashed, showing recovery screen:', error, info);
  }

  render() {
    if (this.state.hasError) {
      // getState (не хук) — класс-компонент не может использовать useStore-хук.
      const lang = useStore.getState().language;
      const ru = lang === 'ru';
      return (
        <div className="h-full flex items-center justify-center bg-bg text-text p-6">
          <div className="text-center max-w-sm">
            <div className="font-display text-[20px] font-bold mb-2">TaskFlow</div>
            <div className="text-[14px] text-muted mb-1">
              {ru ? 'Что-то пошло не так' : 'Something went wrong'}
            </div>
            <div className="text-[12px] text-faint mb-5 leading-relaxed">
              {ru
                ? 'Приложение столкнулось с непредвиденной ошибкой. Ваши данные сохранены — попробуйте перезагрузить.'
                : 'The app hit an unexpected error. Your data is safe — try reloading.'}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-[13px] bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
            >
              {ru ? 'Перезагрузить' : 'Reload'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
