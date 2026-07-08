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
import { useStore } from '../store/useStore';
import { Lang } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import {
  checkAccountBinding,
  createSnapshot,
  setBoundUserId,
  isWebSnapshotLimited,
} from '../lib/snapshots';
import * as db from '../lib/db';

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
  // Защита от повторного открытия для той же сессии (после выбора).
  const handledForUserRef = useRef<string | null>(null);

  const sessionUserId = auth.session?.user?.id ?? null;

  // Детект смены аккаунта: при появлении/смене сессии сверяем bound_user_id.
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
        if (!cancelled && check.mismatch) {
          setOpen(true);
        }
      } catch {
        /* если settings недоступны — не блокируем вход */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionUserId]);

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
    [sessionUserId, busy, runSync, refresh, finishForSession, pushToast, language, t, setCloudEmptyWarning],
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

  if (!open || !sessionUserId) return null;

  const disabled = busy != null;

  return (
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
  );
}
