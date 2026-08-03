/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * logoutLocalSlot.ts — F37 (ADR 0029): запись локального слота free-аккаунта
 * НЕПОСРЕДСТВЕННО перед обычным выходом (Settings → Выход).
 *
 * Корень бага: слот free-аккаунта (F21, ADR 0014) писался только
 *   • автосейвом `useLocalAccountAutosave` — через 30 с тишины после мутации,
 *   • на `beforeunload`/`visibilitychange` (закрытие/сворачивание окна),
 *   • в `AccountSwitchGate`, когда обнаружен рассинхрон при входе в другой
 *     аккаунт (там сохраняется слот УХОДЯЩЕГО аккаунта).
 * Обычный logout не писал слот вообще. Пока приложение живо, слот успевал
 * записаться позже (Gate при входе в следующий аккаунт читает то же
 * sql.js-зеркало), но если между выходом и возвратом приложение
 * перезапускалось (в т.ч. рестарт после restoreSnapshot, ADR 0023) или
 * закрывалось до истечения дебаунса — задача, созданная за секунды до выхода,
 * терялась: зеркало умирало вместе с процессом, а в слоте её ещё не было.
 *
 * `flushOutboxBeforeLogout` (Fix 5) закрывал этот сценарий только для
 * Pro/Trial — у них источник истины облако. Free остался дырой; это симметричная
 * ей заплатка для локального «псевдо-облака».
 *
 * ИНВАРИАНТ (ADR 0014): слот принадлежит free-плану. Для Pro/Trial/Lifetime
 * НЕ пишем ничего — лишний слот мог бы «воскреснуть» при даунгрейде плана.
 */
import { getBoundUserId } from './snapshots';
import { getEntitlement, isProOrTrial } from './entitlements';
import { saveLocalAccountData } from './localAccountStore';
import { flushNativeWrites } from './db';
import { logger } from './logger';

export interface LogoutSlotResult {
  /** Пытались ли писать слот. false → план платный / база не наша (no-op). */
  attempted: boolean;
  /** Записан ли слот. false при attempted=true → пусто/носитель недоступен. */
  saved: boolean;
}

/**
 * Сохраняет слот уходящего free-аккаунта и дожидается, пока очередь записей
 * доедет до файла БД. Никогда не бросает — выход не должен блокироваться.
 */
export async function saveFreeSlotBeforeLogout(
  userId: string,
  email: string | null,
): Promise<LogoutSlotResult> {
  try {
    // База должна принадлежать уходящей сессии: иначе мы в середине смены
    // аккаунта и записали бы в слот чужое состояние.
    const bound = getBoundUserId();
    if (!bound || bound !== userId) return { attempted: false, saved: false };
    const ent = await getEntitlement(userId, email);
    if (isProOrTrial(ent)) return { attempted: false, saved: false };
    const saved = await saveLocalAccountData(userId);
    // F37: параллельно добиваем незавершённые записи в нативную БД, чтобы
    // файловый снимок и следующий запуск увидели то же, что и слот.
    try { await flushNativeWrites(); } catch { /* best-effort */ }
    if (!saved) {
      logger.warn(
        `[logoutLocalSlot] слот free-аккаунта ${userId} не записан (пусто/localStorage недоступен)`,
      );
    }
    return { attempted: true, saved };
  } catch (e) {
    logger.warn('[logoutLocalSlot] pre-logout slot save failed:', e);
    return { attempted: true, saved: false };
  }
}
