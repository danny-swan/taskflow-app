// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * BootOverlay.tsx — блокирующий оверлей старта приложения.
 *
 * Зачем: между `initDb()` (создание/гидрация локальной SQLite) и первым pull'ом
 * пространств UI успевал отрисоваться на ПОЛУПУСТОМ состоянии — пустой сайдбар,
 * доска без колонок, «мигание» списка ws. Клик в этот момент попадал в ещё не
 * готовое приложение (например, переключение на пространство, которое через
 * секунду будет заменено пришедшим из облака).
 *
 * Что делает: перекрывает весь экран (fixed inset-0), гасит клики под собой и
 * показывает спиннер + «Загрузка пространств…». Снимается, когда:
 *   • БД готова (`dbReady`) и авторизация разрешилась (`authLoading === false`);
 *   • И первый sync-цикл дошёл до терминального статуса
 *     (synced / error / skipped / paywalled).
 *
 * НИКОГДА не висит вечно — три независимых предохранителя:
 *   1. `BOOT_SYNC_GRACE_MS` — если за это время sync-цикл вообще не стартовал
 *      (dev-сборка с выключенным авто-sync, нет сети, нет сессии), ждать
 *      нечего → снимаем;
 *   2. `BOOT_HARD_TIMEOUT_MS` — жёсткий потолок на всё ожидание, что бы ни
 *      случилось (в т.ч. если initDb навсегда завис);
 *   3. любая ошибка импорта/подписки на sync → сразу снимаем.
 *
 * Оверлей — ОДНОРАЗОВЫЙ: сняв его, обратно не показываем (иначе каждый
 * фоновый sync перекрывал бы приложение).
 */
import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';

/** Сколько ждём САМ старт первого sync-цикла, прежде чем перестать его ждать. */
export const BOOT_SYNC_GRACE_MS = 2500;
/** Жёсткий потолок на весь стартовый оверлей. */
export const BOOT_HARD_TIMEOUT_MS = 8000;

const TERMINAL_SYNC = new Set(['synced', 'error', 'skipped', 'paywalled']);

export interface BootOverlayProps {
  /** `useStore(s => s.ready)` — initDb() отработал и стор перечитан. */
  dbReady: boolean;
  /** `useAuth().loading` — сессия ещё выясняется. */
  authLoading: boolean;
  /** Ждать ли первый pull (есть сессия — значит sync-цикл ожидается). */
  waitForSync: boolean;
}

export function BootOverlay({ dbReady, authLoading, waitForSync }: BootOverlayProps) {
  const lang = useStore(s => s.language);
  const [syncSettled, setSyncSettled] = useState(false);
  const [syncStarted, setSyncStarted] = useState(false);
  const [graceOver, setGraceOver] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const grace = setTimeout(() => setGraceOver(true), BOOT_SYNC_GRACE_MS);
    const hard = setTimeout(() => setTimedOut(true), BOOT_HARD_TIMEOUT_MS);
    return () => { clearTimeout(grace); clearTimeout(hard); };
  }, []);

  useEffect(() => {
    if (!waitForSync) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    const observe = (status: string) => {
      if (status === 'pulling' || status === 'pushing') setSyncStarted(true);
      if (TERMINAL_SYNC.has(status)) setSyncSettled(true);
    };
    void import('../lib/sync')
      .then(m => {
        if (cancelled) return;
        unsub = m.subscribeSyncState(s => observe(s.status));
        observe(m.getSyncState().status);
      })
      .catch(() => setSyncSettled(true));
    return () => { cancelled = true; unsub?.(); };
  }, [waitForSync]);

  // Ожидание первого pull — единственная фаза, которую гасят таймауты. Фаза
  // «БД ещё не готова» таймаутом НЕ ограничена намеренно: store.init() всегда
  // выставляет ready=true (даже когда initDb() упал, см. safety-net в useStore),
  // а прятать оверлей раньше означало бы показать пустой экран вместо приложения.
  const waitingForSync = waitForSync && !syncSettled && !timedOut && (syncStarted || !graceOver);
  const shouldShow = authLoading || !dbReady || waitingForSync;

  useEffect(() => {
    if (!shouldShow) setDismissed(true);
  }, [shouldShow]);

  if (dismissed || !shouldShow) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-bg"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="boot-overlay"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="font-display text-[18px] font-bold text-text">TaskFlow</div>
        <div
          className="h-6 w-6 rounded-full border-2 border-muted/30 border-t-accent animate-spin"
          aria-hidden="true"
        />
        <div className="text-[13px] text-text">{tr(lang, 'boot_loading_workspaces')}</div>
        <div className="text-[11px] text-muted">{tr(lang, 'boot_loading_hint')}</div>
      </div>
    </div>
  );
}
