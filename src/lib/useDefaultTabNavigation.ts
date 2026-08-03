/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 * https://polyformproject.org/licenses/noncommercial/1.0.0/
 */
import { useEffect, useRef } from 'react';

/**
 * F38 (ADR 0030): активная вкладка = «Вкладка по умолчанию» при входе в аккаунт
 * и при смене пространства.
 *
 * Почему это нужно:
 *  - Приложение под HashRouter, и адрес НЕ сбрасывается при выходе из аккаунта:
 *    вышел из «Настроек» → показался AuthScreen (маршрут остался `#/settings`) →
 *    вошёл → снова «Настройки». Отсюда симптом «иногда при входе оказываюсь
 *    в Настройках».
 *  - `switchWorkspace()` (store) вообще не трогает маршрут: смена пространства
 *    оставляла пользователя на текущей вкладке (например «Статистика»), хотя
 *    ожидается дефолтная вкладка из настроек.
 *
 * Решение — одна точка вместо правок в каждом месте (свитчер пространств,
 * приглашения, создание ws, экран входа): хук сравнивает «кто вошёл» и «какое
 * пространство активно» с предыдущим значением и, если что-то из этого
 * сменилось, переводит на `/<defaultTab>`.
 *
 * Намеренно НЕ навигируем на первом проходе: при обычном старте приложения
 * маршрут уже разрулен роутером (`/` → `/<defaultTab>`), а deep-link
 * (`taskflow://pay/success` → «Настройки → Подписка») перебивать нельзя.
 */
export type DefaultTabNavigationArgs = {
  /** БД инициализирована (до этого defaultTab ещё не прочитан из настроек). */
  ready: boolean;
  /** id пользователя активной сессии; `null` — сессии нет (AuthScreen). */
  userId: string | null;
  /** id активного пространства; `null` — ещё не выбрано. */
  workspaceId: string | null;
  /** Вкладка по умолчанию из настроек (`store.defaultTab`), например 'tasks'. */
  defaultTab: string;
  /** `navigate` из react-router. */
  navigate: (to: string, opts?: { replace?: boolean }) => void;
};

export function useDefaultTabNavigation({
  ready,
  userId,
  workspaceId,
  defaultTab,
  navigate,
}: DefaultTabNavigationArgs): void {
  // Предыдущие значения; `undefined` — ещё ни одного «полезного» прохода не было.
  const prevUserId = useRef<string | null | undefined>(undefined);
  const prevWorkspaceId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Пока БД не готова — defaultTab ещё дефолтный, а не пользовательский:
    // навигировать рано, состояние тоже не запоминаем.
    if (!ready) return;

    const firstPass = prevUserId.current === undefined;
    const userChanged = !firstPass && userId !== prevUserId.current;
    const wsChanged = !firstPass && workspaceId !== prevWorkspaceId.current;

    prevUserId.current = userId;
    prevWorkspaceId.current = workspaceId;

    // Первый проход — только запоминаем: маршрут при старте уже корректен,
    // deep-link не перебиваем.
    if (firstPass) return;
    // Нет сессии (вышли из аккаунта) — показывается AuthScreen, навигация
    // бессмысленна. Предыдущее значение уже обновлено на null, поэтому вход
    // (null → id) будет распознан как смена пользователя.
    if (!userId) return;
    // Пространство ещё не выбрано — ждём.
    if (userChanged || (wsChanged && workspaceId)) {
      navigate(`/${defaultTab}`, { replace: true });
    }
  }, [ready, userId, workspaceId, defaultTab, navigate]);
}
