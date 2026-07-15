// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * logoutFlush.ts — Fix 5 (fix-round2): досыл outbox перед обычным logout.
 *
 * Корень бага: handleSignOut звал supabase.auth.signOut() напрямую, убивая
 * сессию до того, как локальные изменения долетали в облако. Сценарий потери:
 * «создал личное ws → нажал Выход → данные не долетели → пропали». Fix 3 закрыл
 * только AccountSwitchGate; обычный logout оставался дырой.
 *
 * Пушим ТОЛЬКО когда это безопасно и осмысленно:
 *   • уходящая база принадлежит текущей сессии (bound === userId);
 *   • план pro/trial/lifetime (у free сети нет — данные локальны, снимок защитит);
 *   • в outbox реально есть что слать.
 * Ошибки/недоступность сети → attempted=true, failed=true: вызывающий покажет
 * предупреждение и создаст снимок, но выход НЕ блокируется (signOut обязан пройти).
 */
import { getBoundUserId } from '../snapshots';
import { getClientId } from '../clientId';
import { getEntitlement, isProOrTrial } from '../entitlements';
import { get } from '../db';
import { logger } from '../logger';

export interface LogoutFlushResult {
  /** Делали ли реальный сетевой push. false → нечего/нельзя слать (no-op). */
  attempted: boolean;
  /** Остались ли непереданные строки (push упал или сеть недоступна). */
  failed: boolean;
}

export async function flushOutboxBeforeLogout(
  userId: string,
  email: string | null,
): Promise<LogoutFlushResult> {
  try {
    const bound = getBoundUserId();
    if (!bound || bound !== userId) return { attempted: false, failed: false };
    const pending = get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox')?.n ?? 0;
    if (pending <= 0) return { attempted: false, failed: false };
    const ent = await getEntitlement(bound, email);
    if (!isProOrTrial(ent)) return { attempted: false, failed: false };
    const clientId = getClientId();
    if (!clientId) return { attempted: false, failed: false };
    const { pushAll } = await import('./push');
    const r = await pushAll(bound, clientId);
    return { attempted: true, failed: r.failed > 0 };
  } catch (e) {
    logger.warn('[sync/logoutFlush] pre-logout flush failed:', e);
    return { attempted: true, failed: true };
  }
}
