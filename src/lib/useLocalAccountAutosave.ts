/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * useLocalAccountAutosave — автосейв активного free-аккаунта в его локальный
 * слот (F21, ADR 0014).
 *
 * Без автосейва слот писался бы только в момент смены аккаунта в
 * `AccountSwitchGate`. Но уйти с аккаунта можно и мимо этого пути (краш,
 * убитый процесс, переустановка поверх), поэтому активная сессия периодически
 * сбрасывает своё состояние в слот сама.
 *
 * ИНВАРИАНТ (ADR 0014): только free. Pro/Trial/Lifetime не пишут слот вовсе —
 * у них источник истины облако, а лишний слот на диске был бы мусором,
 * способным «воскреснуть» при даунгрейде плана.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { getEntitlement, isProOrTrial } from './entitlements';
import { getBoundUserId } from './snapshots';
import { saveLocalAccountData } from './localAccountStore';

/** Тишина после последней мутации данных, после которой пишем слот. */
const AUTOSAVE_DEBOUNCE_MS = 30_000;

export function useLocalAccountAutosave(userId: string | null, userEmail: string | null): void {
  // Обновляется асинхронно (getEntitlement ходит в сеть с фолбэком на кэш);
  // до ответа автосейв не пишет ничего.
  const freeRef = useRef(false);

  useEffect(() => {
    freeRef.current = false;
    if (!userId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    (async () => {
      const ent = await getEntitlement(userId, userEmail);
      if (!cancelled) freeRef.current = !isProOrTrial(ent);
    })();

    const flush = () => {
      if (!freeRef.current) return;
      // База должна принадлежать текущей сессии: иначе мы в середине смены
      // аккаунта и записали бы чужое (или уже очищенное) состояние.
      if (getBoundUserId() !== userId) return;
      void saveLocalAccountData(userId);
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; flush(); }, AUTOSAVE_DEBOUNCE_MS);
    };

    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.tasks === prev.tasks && state.tags === prev.tags && state.statuses === prev.statuses) return;
      schedule();
    });

    // Закрытие/сворачивание окна: дописываем немедленно, не дожидаясь дебаунса.
    // В Tauri `beforeunload` при закрытии окна срабатывает не всегда, поэтому
    // подстраховываемся `visibilitychange` (сворачивание/уход на фон).
    const flushNow = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      flush();
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushNow(); };
    window.addEventListener('beforeunload', flushNow);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
      window.removeEventListener('beforeunload', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId, userEmail]);
}
