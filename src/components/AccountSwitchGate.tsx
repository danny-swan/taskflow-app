/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.35-dev.6.9.0 — Гейт смены аккаунта на одном устройстве.
 *
 * Проблема (корень бага изоляции):
 *   Локальная база — один файл на устройство, НЕ на аккаунт. При входе под
 *   другим аккаунтом старые задачи «прилипали» к новому аккаунту при push
 *   (user_id брался из текущей сессии). Пользователь мог молча смешать данные.
 *
 * Решение:
 *   1. База помечается bound_user_id после первого успешного sync.
 *   2. При входе под ДРУГИМ аккаунтом (bound_user_id != session.user.id) —
 *      показываем этот гейт и НЕ даём молча запушить чужие данные.
 *   3. Перед ЛЮБЫМ разрушающим действием создаём локальный снимок — старую
 *      базу всегда можно восстановить, даже офлайн (не завязано на облако).
 *
 * Три варианта (по решению пользователя):
 *   • «Загрузить облачные»  — очистить локальные данные и подтянуть из облака
 *                             нового аккаунта. (Снимок сохранён.)
 *   • «Оставить локальные»  — привязать текущую локальную базу к новому
 *                             аккаунту и записать её в его облако.
 *                             ⚠ ДИСКЛЕЙМЕР про возможную потерю несинхронизированных
 *                             данных другого аккаунта.
 *   • «Объединить»          — оставить локальные + подтянуть облачные (merge).
 *
 * Стиль — как PaywallModal: bg-surface / border-border / text-muted / text-accent.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { AlertTriangle, CloudDownload, HardDrive, GitMerge, X, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { useStore } from '../store/useStore';
import { Lang } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import {
  checkAccountBinding,
  createSnapshot,
  setBoundUserId,
  getBoundUserId,
  isWebSnapshotLimited,
  readRegistry,
  restoreSnapshot,
} from '../lib/snapshots';
import { getEntitlement, isProOrTrial } from '../lib/entitlements';
import { saveLocalAccountData, loadLocalAccountData } from '../lib/localAccountStore';
import { reconcilePersonalWorkspace, computeWorkspaceId } from '../lib/sync/workspace';
import { getClientId } from '../lib/clientId';
import * as db from '../lib/db';
import { logger } from '../lib/logger';

/**
 * F30 (ADR 0023): пустой файловый снимок — база сразу после clearUserData()
 * первого входа под этим аккаунтом. SQLite-файл без данных весит ровно 4096
 * байт (заголовок страницы), а `taskCount` в этом случае 0. Такой снимок не
 * несёт данных аккаунта — восстанавливать его как fallback нельзя (иначе мы
 * молча подменили бы «нет данных» на «пустая база восстановлена», и seed
 * welcome-задачи никогда бы не сработал для реально нового аккаунта).
 */
const EMPTY_SNAPSHOT_SIZE = 4096;

function isNonEmptySnapshot(meta: { size: number; taskCount?: number }): boolean {
  if ((meta.taskCount ?? 0) > 0) return true;
  if ((meta.taskCount ?? 0) === 0) return false; // known count, точно пусто
  return meta.size > EMPTY_SNAPSHOT_SIZE; // taskCount отсутствует (старый снимок) — судим по размеру
}

/**
 * F30 (ADR 0023): последний непустой файловый снимок `before_account_switch`
 * для ВХОДЯЩЕГО аккаунта (sessionUserId). Вызывается ПОСЛЕ setBoundUserId(sessionUserId)
 * (строка 192 ниже), поэтому readRegistry()/getBoundUserId() уже относятся к
 * входящему аккаунту — доп. привязка по id не нужна, но boundUserId записи
 * всё равно сверяется явно (safety-снимок уходящего аккаунта, созданный чуть
 * выше в этом же проходе, несёт boundUserId ВЫХОДЯЩЕГО и будет отфильтрован).
 */
function findLatestAccountSnapshot(sessionUserId: string) {
  const list = readRegistry();
  const candidates = list.filter(
    (m) => m.label === 'before_account_switch' && m.boundUserId === sessionUserId && isNonEmptySnapshot(m),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0));
  return candidates[0];
}

// ─── i18n локально (компактный диф, как в PaywallModal) ───────────────────────
type L10nKey =
  | 'title'
  | 'subtitle'
  | 'safety_note'
  | 'web_limited'
  | 'opt_cloud_title'
  | 'opt_cloud_desc'
  | 'opt_local_title'
  | 'opt_local_desc'
  | 'opt_local_disclaimer'
  | 'opt_merge_title'
  | 'opt_merge_desc'
  | 'creating_snapshot'
  | 'applying'
  | 'err_generic'
  | 'signout';

const L10N: Record<Lang, Record<L10nKey, string>> = {
  ru: {
    title: 'Вы вошли под другим аккаунтом',
    subtitle:
      'На этом устройстве уже есть локальная база данных, привязанная к другому аккаунту. Выберите, что сделать с текущими данными.',
    safety_note:
      'Перед любым действием мы автоматически создадим локальный снимок текущей базы. Старые данные не будут потеряны — их можно восстановить в Настройках → Синхронизация, даже без интернета.',
    web_limited:
      'Внимание: в веб-версии снимки хранятся в браузере и имеют ограничения по объёму. Полноценные снимки доступны в десктоп-версии.',
    opt_cloud_title: 'Загрузить облачные',
    opt_cloud_desc:
      'Очистить локальные данные и загрузить задачи из облака нового аккаунта. Текущая база сохранится в снимке.',
    opt_local_title: 'Оставить локальные',
    opt_local_desc:
      'Привязать текущую локальную базу к новому аккаунту и записать её в его облако.',
    opt_local_disclaimer:
      'Локальные задачи будут записаны в облако аккаунта. Если эти задачи принадлежали другому аккаунту и не были синхронизированы в его облако, в облаке того аккаунта они не появятся — но локальная копия сохранена в снимке и её можно восстановить.',
    opt_merge_title: 'Объединить',
    opt_merge_desc:
      'Оставить локальные задачи и добавить к ним задачи из облака нового аккаунта (без удаления).',
    creating_snapshot: 'Создаём снимок текущей базы…',
    applying: 'Применяем…',
    err_generic: 'Не удалось выполнить действие',
    signout: 'Выйти из аккаунта',
  },
  en: {
    title: 'You signed in with a different account',
    subtitle:
      'This device already has a local database bound to another account. Choose what to do with the current data.',
    safety_note:
      'Before any action we automatically create a local snapshot of the current database. Old data will not be lost — you can restore it in Settings → Sync, even offline.',
    web_limited:
      'Note: in the web version snapshots are stored in the browser and have size limits. Full snapshots are available in the desktop version.',
    opt_cloud_title: 'Load cloud data',
    opt_cloud_desc:
      "Clear local data and download tasks from the new account's cloud. The current database is saved to a snapshot.",
    opt_local_title: 'Keep local data',
    opt_local_desc:
      "Bind the current local database to the new account and write it to that account's cloud.",
    opt_local_disclaimer:
      "Local tasks will be written to the account's cloud. If these tasks belonged to another account and were not synced to its cloud, they will not appear in that account's cloud — but a local copy is saved in a snapshot and can be restored.",
    opt_merge_title: 'Merge',
    opt_merge_desc:
      "Keep local tasks and add tasks from the new account's cloud to them (nothing is deleted).",
    creating_snapshot: 'Creating a snapshot of the current database…',
    applying: 'Applying…',
    err_generic: 'Failed to perform the action',
    signout: 'Sign out',
  },
};

type Choice = 'cloud' | 'local' | 'merge';

export function AccountSwitchGate() {
  const auth = useAuth();
  const language = useStore((s) => s.language);
  const pushToast = useStore((s) => s.pushToast);
  const refresh = useStore((s) => s.refresh);

  // t() через ref — паттерн из проекта (урок AdminPage), чтобы не пересоздавать
  // колбэки и не ловить устаревший lang в замыканиях.
  const langRef = useRef<Lang>(language);
  langRef.current = language;
  const t = useCallback((k: L10nKey) => L10N[langRef.current][k], []);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'snapshot' | 'checking' | 'apply'>(null);
  const [error, setError] = useState<string | null>(null);
  // Если true — облако пустое, показываем предупреждение перед стиранием.
  const [cloudEmptyWarning, setCloudEmptyWarning] = useState(false);
  // F30 (ADR 0023): true, когда auto-restore из файлового снимка (fallback
  // при пустом localStorage-слоте) вернул needsRestart:true (Tauri) — тот же
  // паттерн, что и restartAfterRestore в Settings.tsx (handleRestoreSnapshot).
  const [restartAfterAutoRestore, setRestartAfterAutoRestore] = useState(false);
  // Защита от повторного открытия для той же сессии (после выбора).
  const handledForUserRef = useRef<string | null>(null);

  const sessionUserId = auth.session?.user?.id ?? null;
  const sessionUserEmail = auth.session?.user?.email ?? null;

  // Детект смены аккаунта: при появлении/смене сессии сверяем bound_user_id.
  //
  // v0.9.35-dev.6.10.3 — Entitlement-гейт (фикс: окно смены аккаунта показывалось
  // даже free-аккаунту без подписки).
  //   Синхронизация — платная фича (гейт в lib/sync/index.ts блокирует free/expired
  //   как status='paywalled'). Значит для free-аккаунта нет самой синхронизации, а
  //   все три варианта окна (cloud/local/merge) её так или иначе дёргают. Показывать
  //   это окно free-аккаунту бессмысленно и вводит в заблуждение. Поэтому перед
  //   открытием проверяем entitlement: если не Pro/Trial/Lifetime — окно не
  //   показываем (данные при этом не трогаются, привязка bound_user_id не меняется).
  useEffect(() => {
    if (!sessionUserId) {
      setOpen(false);
      return;
    }
    if (handledForUserRef.current === sessionUserId) return;
    let cancelled = false;
    (async () => {
      // Небольшая пауза — даём initDb/миграциям отработать (App монтирует гейт
      // после ready, но перестраховываемся).
      try {
        const check = checkAccountBinding(sessionUserId);
        if (cancelled || !check.mismatch) return;

        // Есть расхождение аккаунтов — но показываем окно только если у нового
        // аккаунта есть право на синхронизацию (Pro/Trial/Lifetime). getEntitlement
        // при офлайне падает на локальный кэш, поэтому не блокирует вход.
        const ent = await getEntitlement(sessionUserId, sessionUserEmail);
        if (cancelled) return;
        if (!isProOrTrial(ent)) {
          // Free-аккаунт: облака/синхронизации у него нет, поэтому окно с тремя
          // вариантами (cloud/local/merge) бессмысленно. Но оставлять локальные
          // данные ПРОШЛОГО аккаунта видимыми под новым нельзя — это утечка между
          // аккаунтами (баг F). Делаем локальную (без сети) перепривязку:
          // слот уходящего → снимок → очистка → bound_user_id=new →
          // пересоздание personal-ws → слот нового (или сев, если слота нет).
          try {
            // F21 (ADR 0014): сохраняем данные УХОДЯЩЕГО аккаунта в его
            // персональный слот — до clearUserData и до смены bound_user_id.
            // Это локальный аналог облака: при возврате на этот аккаунт данные
            // подставятся обратно (ниже по коду), а не потеряются в ротации снимков.
            const savedSlot = await saveLocalAccountData(check.boundUserId);
            if (!savedSlot) {
              // F30: раньше результат тихо отбрасывался — сбой сохранения слота
              // проходил незамеченным, и диагностика "почему restore не сработал"
              // не видела эту причину. Не критично (файловый снимок ниже страхует
              // и уходящий, и входящий аккаунт), но должно быть видно в логах.
              logger.warn(
                `[AccountSwitchGate] saveLocalAccountData(${check.boundUserId}) вернул false — слот уходящего аккаунта не сохранён (пусто/localStorage недоступен)`,
              );
            }
            await createSnapshot('before_account_switch');
            // Fix 3: снимок — гарантированная защита несинхронизированных данных
            // уходящего аккаунта (создан выше). Сетевой долив здесь невозможен:
            // сессия уже принадлежит новому пользователю (bound !== session),
            // а push под чужой сессией нарушил бы изоляцию (Fix F). Снимок покрывает.
            await db.clearUserData();
            setBoundUserId(sessionUserId);
            reconcilePersonalWorkspace(sessionUserId);
            // F21: реконсиль обязан пройти ДО восстановления — applyBackup
            // штампует строки текущим current_workspace_id, то есть personal-ws
            // НОВОГО аккаунта.
            //
            // F30 (ADR 0023): порядок восстановления — slot → файловый снимок → seed.
            // 1) localStorage-слот (loadLocalAccountData) — как раньше, быстрый путь
            //    без перезапуска, обратная совместимость.
            // 2) Если слота нет/пуст — ПРЕЖДЕ чем сеять welcome, пробуем последний
            //    непустой файловый снимок 'before_account_switch' ВХОДЯЩЕГО аккаунта
            //    (findLatestAccountSnapshot фильтрует по boundUserId===sessionUserId
            //    и taskCount/size, так что safety-снимок УХОДЯЩЕГО аккаунта, созданный
            //    строкой выше, сюда не попадёт — у него boundUserId=check.boundUserId).
            //    В Tauri restoreSnapshot требует перезапуска приложения (заменить
            //    открытый data.db на лету нельзя) — это ADR 0023, пересмотр
            //    альтернативы C из ADR 0014 (перезапуск теперь приемлем ради
            //    сохранности данных). Seed НЕ вызываем — после рестарта приложение
            //    поднимется уже с восстановленной data.db.
            // 3) Если файлового снимка тоже нет (реально новый аккаунт) — сеем
            //    welcome, как раньше.
            let restored = await loadLocalAccountData(sessionUserId);
            let restoredFromFileSnapshot = false;
            let needsRestart = false;
            if (!restored) {
              const snap = findLatestAccountSnapshot(sessionUserId);
              if (snap) {
                try {
                  const result = await restoreSnapshot(snap.id);
                  restored = true;
                  restoredFromFileSnapshot = true;
                  needsRestart = result.needsRestart;
                } catch (e) {
                  logger.warn(
                    `[AccountSwitchGate] restoreSnapshot(${snap.id}) для sessionUserId=${sessionUserId} провалился, сеем welcome:`,
                    e,
                  );
                }
              }
            }
            if (!restored) {
              // F36 (ADR 0028): ws-id для штампа seed-строк передаём ЯВНО.
              // reconcilePersonalWorkspace выше пишет `personal_workspace_id` через
              // синхронный db.run(), который в Tauri доводит запись до нативной
              // SQLite fire-and-forget, а ensureSeededIfEmpty читал указатель из
              // нативной базы — и на свежем free-аккаунте видел пустоту: 7
              // сид-статусов уезжали на `ws_local`, welcome-задача — на `ws_<uid>`,
              // и «Задачи» открывались пустыми (доска рендерит колонки по
              // статусам текущего ws).
              const seedWsId = computeWorkspaceId(sessionUserId);
              await db.ensureSeededIfEmpty(seedWsId);
              await db.ensureWelcomeTaskIfNeeded(sessionUserId, seedWsId);
            }
            if (needsRestart) {
              // Не сеем welcome, не трогаем стор — после рестарта приложение
              // поднимется уже с восстановленной data.db (тот же механизм, что
              // Settings.tsx handleRestoreSnapshot → setRestartAfterRestore).
              if (!cancelled) setRestartAfterAutoRestore(true);
            } else if (!cancelled) {
              // Fix 2: сперва привязку (boundUserId + ws/members) — иначе
              // computeRole не увидит owner-роль нового personal-ws.
              try { useStore.getState().reloadAccountBinding?.(); } catch { /* best-effort */ }
              try { await Promise.resolve(useStore.getState().refresh?.()); } catch { /* best-effort */ }
              useStore.getState().pushToast(
                restoredFromFileSnapshot
                  ? (langRef.current === 'ru'
                    ? 'Вы вошли под другим аккаунтом. Данные восстановлены из снимка (веб).'
                    : 'Signed in with a different account. Data restored from a snapshot (web).')
                  : restored
                    ? (langRef.current === 'ru'
                      ? 'Вы вошли под другим аккаунтом. Восстановлены локальные данные этого аккаунта.'
                      : 'Signed in with a different account. Local data of this account has been restored.')
                    : (langRef.current === 'ru'
                      ? 'Вы вошли под другим аккаунтом. Локальные данные очищены, снимок сохранён.'
                      : 'Signed in with a different account. Local data cleared, snapshot saved.'),
              );
            }
          } catch (e) {
            // Не зацикливаем: помечаем сессию обработанной даже при ошибке.
            // eslint-disable-next-line no-console
            console.warn('[AccountSwitchGate] free-tier local rebind failed:', e);
          }
          handledForUserRef.current = sessionUserId;
          return;
        }
        setOpen(true);
      } catch {
        /* если settings/сеть недоступны — не блокируем вход */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId, sessionUserEmail]);

  const finishForSession = useCallback(() => {
    if (sessionUserId) handledForUserRef.current = sessionUserId;
    setOpen(false);
    setBusy(null);
    setError(null);
  }, [sessionUserId]);

  const runSync = useCallback(async () => {
    // Ленивый импорт, чтобы не тянуть sync в бандл раньше времени.
    const m = await import('../lib/sync');
    await m.syncNow();
  }, []);

  // Fix 3: попытка долить outbox в облако ПЕРЕД разрушающим clearUserData.
  //
  // Возвращает true, если стирать безопасно (нечего доливать / долив прошёл /
  // сеть недоступна, но снимок уже создан). Возвращает false ТОЛЬКО когда долив
  // был реально нужен, начат и завершился с непереданными строками — тогда
  // вызывающий отменяет стирание (не теряем несинхронизированное сверх снимка).
  //
  // Ключевой инвариант изоляции (Fix F): сетевой долив выполняется лишь когда
  // уходящая база принадлежит ТЕКУЩЕЙ сессии (bound === session). При смене
  // аккаунта (bound !== session) push под чужой сессией переклеил бы user_id на
  // новый аккаунт — поэтому не пушим, полагаемся на снимок (создаётся всегда).
  const flushOutboxBeforeClear = useCallback(async (): Promise<boolean> => {
    try {
      const bound = getBoundUserId();
      if (!bound || bound !== sessionUserId) return true; // смена аккаунта → снимок
      const pending = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox')?.n ?? 0;
      if (pending <= 0) return true;
      const ent = await getEntitlement(bound, sessionUserEmail);
      if (!isProOrTrial(ent)) return true; // free: сети нет, снимок защитит
      const clientId = getClientId();
      if (!clientId) return true;
      const { pushAll } = await import('../lib/sync/push');
      const r = await pushAll(bound, clientId);
      // «Стираем только после успеха»: если остались непереданные строки —
      // не стираем (снимок уже есть, пользователь может повторить).
      return r.failed === 0;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[AccountSwitchGate] pre-clear flush failed:', e);
      return false;
    }
  }, [sessionUserId, sessionUserEmail]);

  const handleChoice = useCallback(
    async (choice: Choice, forceCloud = false) => {
      if (!sessionUserId || busy) return;
      setError(null);
      setCloudEmptyWarning(false);
      try {
        // 1. ВСЕГДА снимок текущей базы перед изменениями (никогда не теряем старое).
        setBusy('snapshot');
        await createSnapshot('before_account_switch');

        // 2. Применяем выбор.
        if (choice === 'cloud') {
          // Пред стиранием локальных — проверяем, есть ли что-то в облаке.
          // Если облако пустое и пользователь не подтвердил операцию — показываем
          // предупреждение (снимок уже сохранён, данные не потеряются).
          if (!forceCloud) {
            setBusy('checking');
            const m = await import('../lib/sync');
            const hasData = await m.cloudHasData(sessionUserId);
            if (!hasData) {
              setBusy(null);
              setCloudEmptyWarning(true);
              return;
            }
          }

          // Очистить локальные + снять привязку → sync подтянет облако нового
          // аккаунта и заново привяжет базу к нему.
          setBusy('apply');
          // Fix 3: перед стиранием доливаем outbox (безопасно только для своей
          // сессии; при смене аккаунта — no-op, защита через снимок выше).
          const safeToClear = await flushOutboxBeforeClear();
          if (!safeToClear) {
            setBusy(null);
            setError(
              language === 'ru'
                ? 'Остались несинхронизированные изменения. Снимок сохранён — повторите позже.'
                : 'Some changes are not synced yet. A snapshot is saved — please retry later.',
            );
            return;
          }
          await db.clearUserData();
          setBoundUserId(null);
          await runSync();
        } else if (choice === 'local') {
          // Оставить локальные: привязываем базу к новому аккаунту и пушим.
          // sync сам проставит user_id из сессии при push (LWW), bound_user_id
          // мы ставим сразу, чтобы гейт больше не срабатывал.
          setBoundUserId(sessionUserId);
          await runSync();
        } else {
          // Объединить: оставляем локальные, привязываем к новому и делаем
          // полный цикл (pull подтянет облачные, push отправит локальные).
          setBoundUserId(sessionUserId);
          await runSync();
        }

        // 3. Обновляем UI и закрываем.
        // Fix 2: перечитываем привязку (boundUserId + ws/members), чтобы
        // computeRole сразу увидел owner-роль текущего аккаунта и UI не показывал
        // «Только владелец пространства может менять статусы…».
        try { useStore.getState().reloadAccountBinding?.(); } catch { /* best-effort */ }
        try { await Promise.resolve(refresh?.()); } catch { /* refresh best-effort */ }
        finishForSession();
        pushToast(
          language === 'ru' ? 'Готово. Снимок старой базы сохранён.' : 'Done. Snapshot of the old database saved.',
        );
      } catch (e) {
        setBusy(null);
        const msg = e instanceof Error ? e.message : String(e);
        setError(`${t('err_generic')}: ${msg}`);
      }
    },
    [sessionUserId, busy, runSync, flushOutboxBeforeClear, refresh, finishForSession, pushToast, language, t, setCloudEmptyWarning],
  );

  const handleSignOut = useCallback(async () => {
    if (busy) return;
    try {
      // Снимок перед выходом тоже — на всякий случай.
      setBusy('snapshot');
      await createSnapshot('before_signout_at_gate');
    } catch { /* не критично */ }
    try {
      const { signOut } = await import('../lib/auth');
      await signOut();
    } catch { /* ignore */ }
    finishForSession();
  }, [busy, finishForSession]);

  // F30 (ADR 0023): тот же механизм перезапуска, что handleRestartAfterRestore в
  // Settings.tsx: в Tauri restore уже заменил data.db на диске (старый файл
  // держит открытым sql-плагин), нужен реальный рестарт процесса.
  const handleRestartAfterAutoRestore = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('restart_app');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[AccountSwitchGate] restart_app error:', e);
      pushToast(
        langRef.current === 'ru'
          ? 'Не удалось перезапустить. Закройте и запустите приложение вручную.'
          : 'Restart failed. Please close and start the app manually.',
      );
    }
  }, [pushToast]);

  // Диалог перезапуска после auto-restore из файлового снимка не зависит от
  // `open`/главной модалки (для free-аккаунта она вообще не показывается)—
  // рендерим его отдельно от раннего return.
  const restartDialog = (
    <ConfirmDialog
      open={restartAfterAutoRestore}
      title={langRef.current === 'ru' ? 'Восстанавливаем данные, перезапуск…' : 'Restoring your data, restart required…'}
      message={langRef.current === 'ru'
        ? 'Найден сохранённый снимок данных этого аккаунта. Чтобы применить его, нужно перезапустить приложение.'
        : 'A saved snapshot of this account was found. The app needs to restart to apply it.'}
      confirmLabel={langRef.current === 'ru' ? 'Перезапустить сейчас' : 'Restart now'}
      cancelLabel={langRef.current === 'ru' ? 'Позже' : 'Later'}
      onConfirm={() => { setRestartAfterAutoRestore(false); void handleRestartAfterAutoRestore(); }}
      onCancel={() => setRestartAfterAutoRestore(false)}
    />
  );

  if (!open || !sessionUserId) return restartDialog;

  const disabled = busy != null;

  return (
    <>
      {restartDialog}
    <Modal open={open} onClose={() => { /* намеренно не закрываем по клику вне — выбор обязателен */ }} width={620} label={t('title')}>
      <div className="p-6 overflow-y-auto">
        <div className="flex items-start gap-3 mb-4">
          <div className="mt-0.5 shrink-0 w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center">
            <AlertTriangle size={18} className="text-accent" />
          </div>
          <div>
            <h2 className="font-display text-[18px] font-bold text-text leading-tight">{t('title')}</h2>
            <p className="text-[13px] text-muted mt-1 leading-relaxed">{t('subtitle')}</p>
          </div>
        </div>

        {/* Гарантия сохранности старой базы */}
        <div className="rounded-lg border border-border bg-bg/50 px-3 py-2.5 mb-3 text-[12px] text-muted leading-relaxed">
          {t('safety_note')}
        </div>
        {isWebSnapshotLimited() && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 mb-4 text-[12px] text-amber-500 leading-relaxed">
            {t('web_limited')}
          </div>
        )}

        {/* Три варианта */}
        <div className="space-y-2.5">
          {/* Загрузить облачные */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleChoice('cloud')}
            className="w-full text-left rounded-lg border border-border hover:border-accent/50 hover:bg-accent/5 transition-colors px-4 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2 mb-1">
              <CloudDownload size={16} className="text-accent shrink-0" />
              <span className="font-medium text-[14px] text-text">{t('opt_cloud_title')}</span>
            </div>
            <p className="text-[12px] text-muted leading-relaxed">{t('opt_cloud_desc')}</p>
          </button>

          {/* Оставить локальные + дисклеймер */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleChoice('local')}
            className="w-full text-left rounded-lg border border-border hover:border-accent/50 hover:bg-accent/5 transition-colors px-4 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2 mb-1">
              <HardDrive size={16} className="text-accent shrink-0" />
              <span className="font-medium text-[14px] text-text">{t('opt_local_title')}</span>
            </div>
            <p className="text-[12px] text-muted leading-relaxed mb-1.5">{t('opt_local_desc')}</p>
            <p className="text-[11px] text-amber-500 leading-relaxed flex gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{t('opt_local_disclaimer')}</span>
            </p>
          </button>

          {/* Объединить */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleChoice('merge')}
            className="w-full text-left rounded-lg border border-border hover:border-accent/50 hover:bg-accent/5 transition-colors px-4 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2 mb-1">
              <GitMerge size={16} className="text-accent shrink-0" />
              <span className="font-medium text-[14px] text-text">{t('opt_merge_title')}</span>
            </div>
            <p className="text-[12px] text-muted leading-relaxed">{t('opt_merge_desc')}</p>
          </button>
        </div>

        {/* Предупреждение: облако пустое */}
        {cloudEmptyWarning && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 mt-4 text-[12px] leading-relaxed">
            <p className="text-amber-500 font-medium mb-2">
              {language === 'ru'
                ? '⚠️ Облако этого аккаунта пустое'
                : '⚠️ This account’s cloud is empty'}
            </p>
            <p className="text-muted mb-3">
              {language === 'ru'
                ? 'Если продолжить, локальные данные будут стёрты, а загрузить будет нечего. Снимок уже сохранён — вы сможете восстановить данные из него. Всё равно продолжить?'
                : 'If you continue, local data will be cleared and there is nothing to download. A snapshot has already been saved — you can restore it later. Continue anyway?'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleChoice('cloud', true)}
                className="flex-1 rounded-md border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-[12px] font-medium py-1.5 transition-colors"
              >
                {language === 'ru' ? 'Да, стёрть и загрузить' : 'Yes, clear and load'}
              </button>
              <button
                type="button"
                onClick={() => setCloudEmptyWarning(false)}
                className="flex-1 rounded-md border border-border hover:bg-surface text-muted text-[12px] font-medium py-1.5 transition-colors"
              >
                {language === 'ru' ? 'Отмена' : 'Cancel'}
              </button>
            </div>
          </div>
        )}

        {/* Статус / ошибка */}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-muted mt-4">
            <Loader2 size={14} className="animate-spin" />
            <span>{busy === 'snapshot' ? t('creating_snapshot') : busy === 'checking' ? (language === 'ru' ? 'Проверка облака…' : 'Checking cloud…') : t('applying')}</span>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 mt-4 text-[12px] text-red-400 leading-relaxed">
            {error}
          </div>
        )}

        {/* Выход из аккаунта — запасной путь, если пользователь передумал */}
        <div className="mt-5 pt-4 border-t border-border flex justify-end">
          <button
            type="button"
            disabled={disabled}
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text transition-colors disabled:opacity-50"
          >
            <X size={14} />
            {t('signout')}
          </button>
        </div>
      </div>
    </Modal>
    </>
  );
}
