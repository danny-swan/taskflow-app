import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, ThemeName } from '../store/useStore';
import { tr } from '../lib/i18n';
import { Trash2, GripVertical, Plus, Check, Sun, Moon, Sparkles, Leaf, Palette, Download, Upload, HardDrive, AlertTriangle, FolderOpen, Info, FileText, Pencil, RefreshCw, LogOut, User, Shield, KeyRound, Mail, Cloud, Copy, Clock, ExternalLink, CheckCircle2, XCircle, CircleDollarSign, CreditCard, RotateCcw, Ban, Unlink } from 'lucide-react';
import { checkForUpdate, downloadAndInstall, type UpdateInfo } from '../lib/updater';
import { useAuth, signOut, deleteAccount, updateEmail } from '../lib/auth';
import { logEvent } from '../lib/telemetry';
import { PrivacyModal } from '../components/PrivacyModal';
import { PasswordResetModal } from '../components/PasswordResetModal';
import { usePrompt } from '../components/PromptDialog';
import pkg from '../../package.json';
import { downloadFile, todayISO } from '../lib/utils';
import { resetDatabase, isTauri, buildBackup, applyBackup, getSchemaVersion, type BackupPayload } from '../lib/db';
import { logger } from '../lib/logger';
import { ConfirmDialog } from '../components/ConfirmDialog';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { useEntitlement, submitActivationRequest, cancelSubscription, reactivateSubscription, detachPaymentMethod, fetchActivePaymentMethods, changePlan, type PaymentMethodRow } from '../lib/entitlements';
import { supabase } from '../lib/supabase';

type Sub = 'general' | 'account' | 'subscription' | 'tags' | 'statuses' | 'stats' | 'theme' | 'templates' | 'io' | 'storage' | 'sync' | 'updates';

export function SettingsPage() {
  const lang = useStore(s => s.language);
  // v0.9.35-dev.6: если в URL есть #subscription — сразу открываем этот таб.
  // (Ссылка из Sidebar-баннера / PaywallGate.)
  const [sub, setSub] = useState<Sub>(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#subscription') {
      return 'subscription';
    }
    return 'general';
  });

  // Реагируем на hashchange — если уже на /settings и кто-то навигатит на
  // /settings#subscription, переключаем вкладку.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHash = () => {
      if (window.location.hash === '#subscription') setSub('subscription');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // v0.9.35-dev.6.7: сбок сгруппирован визуальными разделителями.
  // 'divider' — визуальный разделитель.
  type NavItem = { key: Sub; label: string } | { key: 'divider'; label?: never };
  const navItems: NavItem[] = [
    // Группа 1: Основные настройки
    { key: 'general', label: tr(lang, 'settings_general') },
    { key: 'statuses', label: tr(lang, 'settings_statuses') },
    { key: 'tags', label: tr(lang, 'settings_tags') },
    { key: 'theme', label: tr(lang, 'settings_theme') },
    { key: 'templates', label: lang === 'ru' ? 'Шаблоны задач' : 'Task templates' },
    // Разделитель
    { key: 'divider' },
    // Группа 2: Аккаунт и подписка
    { key: 'account', label: lang === 'ru' ? 'Аккаунт' : 'Account' },
    { key: 'subscription', label: lang === 'ru' ? 'Подписка' : 'Subscription' },
    // Разделитель
    { key: 'divider' },
    // Группа 3: Данные и обслуживание
    { key: 'io', label: tr(lang, 'settings_io') },
    { key: 'storage', label: tr(lang, 'storage_section') },
    // v0.9.35-dev.6.8.1: вкладка Синхронизация была потеряна при перестановке
    // порядка вкладок — возвращаем между Хранилище и Обновления.
    { key: 'sync', label: lang === 'ru' ? 'Синхронизация' : 'Sync' },
    { key: 'updates', label: lang === 'ru' ? 'Обновления' : 'Updates' },
  ];

  // stats всё ещё есть для прямого перехода (например из кода)
  // без отображения в сбоке.

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-[200px] shrink-0 border-r border-border-soft py-4 px-2.5 overflow-y-auto">
        {navItems.map((item, idx) =>
          item.key === 'divider'
            ? <div key={`div-${idx}`} className="my-2 border-t border-border-soft/60" />
            : <button
                key={item.key}
                onClick={() => setSub(item.key as Sub)}
                className={'w-full text-left px-3 py-1.5 mb-0.5 rounded-md text-[13px] ' +
                  (sub === item.key ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-surface-alt')}
              >{item.label}</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {sub === 'general' && <GeneralSection />}
        {sub === 'account' && <AccountSection />}
        {sub === 'subscription' && <SubscriptionSection />}
        {sub === 'tags' && <TagsSection />}
        {sub === 'statuses' && <StatusesSection />}
        {sub === 'stats' && <StatsToggleSection />}
        {sub === 'theme' && <ThemeSection />}
        {sub === 'templates' && <TemplatesSection lang={lang} />}
        {sub === 'io' && <IOSection />}
        {sub === 'storage' && <StorageSection />}
        {sub === 'sync' && <SyncSection />}
        {sub === 'updates' && <UpdatesSection />}
      </div>
    </div>
  );
}

function GeneralSection() {
  const lang = useStore(s => s.language);
  const setLang = useStore(s => s.setLanguage);
  const fontSize = useStore(s => s.fontSize);
  const setFontSize = useStore(s => s.setFontSize);
  const defaultTab = useStore(s => s.defaultTab);
  const setDefaultTab = useStore(s => s.setDefaultTab);
  const overdueMode = useStore(s => s.overdueMode);         // v0.9.2 (№1)
  const setOverdueMode = useStore(s => s.setOverdueMode);   // v0.9.2 (№1)
  // v0.9.28: автоочистка выполненных задач
  const autocleanupEnabled = useStore(s => s.autocleanupEnabled);
  const autocleanupMode = useStore(s => s.autocleanupMode);
  const autocleanupDay = useStore(s => s.autocleanupDay);
  const autocleanupMinAgeDays = useStore(s => s.autocleanupMinAgeDays);
  const setAutocleanupEnabled = useStore(s => s.setAutocleanupEnabled);
  const setAutocleanupMode = useStore(s => s.setAutocleanupMode);
  const setAutocleanupDay = useStore(s => s.setAutocleanupDay);
  const setAutocleanupMinAgeDays = useStore(s => s.setAutocleanupMinAgeDays);
  const runAutoCleanup = useStore(s => s.runAutoCleanup);
  const updateTask = useStore(s => s.updateTask);
  const pushToast = useStore(s => s.pushToast);
  const [cleanNowConfirm, setCleanNowConfirm] = useState(false);

  const dayNames = lang === 'ru'
    ? ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // v0.9.30: кнопка «Почистить сейчас» — ignoreAge=true, всегда все выполненные. Плюс Undo (10 с).
  const handleCleanNow = () => {
    const result = runAutoCleanup({ manual: true, ignoreAge: true });
    if (result.count === 0) {
      pushToast(lang === 'ru' ? 'Нечего чистить' : 'Nothing to clean up');
      return;
    }
    const msg = lang === 'ru'
      ? `Архивировано ${result.count} ${result.count === 1 ? 'задача' : result.count < 5 ? 'задачи' : 'задач'}`
      : `Archived ${result.count} task${result.count === 1 ? '' : 's'}`;
    const ids = [...result.ids];
    pushToast(msg, {
      label: lang === 'ru' ? 'Отменить' : 'Undo',
      onClick: () => {
        for (const id of ids) updateTask(id, { archived: 0 });
        pushToast(lang === 'ru' ? 'Восстановлено' : 'Restored');
      },
    });
  };

  return (
    <div className="max-w-xl space-y-4">
      <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_general')}</h3>

      {/* ─── Блок: Основные параметры ─── */}
      <div className="bg-surface-alt border border-border-soft rounded-lg p-4 space-y-4">
        <h4 className="text-[13px] font-semibold text-muted uppercase tracking-wide">
          {lang === 'ru' ? 'Основные' : 'General'}
        </h4>

      <Row label={tr(lang, 'language')}>
        <div className="flex gap-2">
          {(['ru', 'en'] as const).map(l => (
            <button key={l}
              onClick={() => setLang(l)}
              className={'px-3 py-1 text-[13px] rounded border ' +
                (lang === l ? 'bg-accent text-white border-accent' : 'border-border-soft hover:bg-surface-alt')}
            >{l.toUpperCase()}</button>
          ))}
        </div>
      </Row>

      <Row label={tr(lang, 'font_size') + ` · ${fontSize}px`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFontSize(Math.max(12, fontSize - 1))}
            disabled={fontSize <= 12}
            aria-label={lang === 'ru' ? 'Уменьшить шрифт' : 'Decrease font size'}
            className="w-8 h-8 flex items-center justify-center rounded border border-border-soft text-[16px] font-semibold hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed"
          >−</button>
          <input
            type="range" min={12} max={18} value={fontSize}
            onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => setFontSize(Math.min(18, fontSize + 1))}
            disabled={fontSize >= 18}
            aria-label={lang === 'ru' ? 'Увеличить шрифт' : 'Increase font size'}
            className="w-8 h-8 flex items-center justify-center rounded border border-border-soft text-[16px] font-semibold hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed"
          >+</button>
        </div>
      </Row>

      <Row label={tr(lang, 'default_tab')}>
        <select
          value={defaultTab}
          onChange={(e) => setDefaultTab(e.target.value)}
          className="bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
        >
          {/* v0.8.6: «Добавить» убрана из вкладок-по-умолчанию */}
          <option value="tasks">{tr(lang, 'nav_tasks')}</option>
          <option value="calendar">{tr(lang, 'nav_calendar')}</option>
          <option value="dashboard">{tr(lang, 'nav_dashboard')}</option>
          <option value="stats">{tr(lang, 'nav_stats')}</option>
        </select>
      </Row>

      {/* v0.9.31: часовой пояс — используется везде, где вычисляется todayISO() */}
      <TimezoneRow lang={lang} />

      {/* v0.9.2 (№1): режим подсчёта просрочки и остатка дней на карточках задач */}
      <Row label={lang === 'ru' ? 'Логика дедлайнов' : 'Deadline logic'}>
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            {(['calendar', 'business'] as const).map(m => (
              <button
                key={m}
                onClick={() => setOverdueMode(m)}
                className={'px-3 py-1 text-[13px] rounded border ' +
                  (overdueMode === m ? 'bg-accent text-white border-accent' : 'border-border-soft hover:bg-surface-alt')}
              >
                {m === 'calendar'
                  ? (lang === 'ru' ? 'Календарные дни' : 'Calendar days')
                  : (lang === 'ru' ? 'Рабочие дни (Пн–Пт)' : 'Business days (Mon–Fri)')}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-muted">
            {lang === 'ru'
              ? 'Влияет на «Просрочено N дн.» и «Дней осталось N» на карточках, а также на чип «Внимание». В режиме «Рабочие дни» выходные (Сб-Вс) не учитываются.'
              : 'Affects «Overdue N d» and «N days left» on task cards, plus the «Attention» chip. In «Business days» mode weekends (Sat-Sun) are skipped.'}
          </div>
        </div>
      </Row>

      </div>{/* /блок Основные */}

      {/* ─── Блок: Автоочистка ─── */}
      {/* v0.9.30: автоочистка выполненных задач — два режима (weekday/age) */}
      <div className="bg-surface-alt border border-border-soft rounded-lg p-4 space-y-3">
        <h4 className="font-display text-[14px] font-semibold">
          {lang === 'ru' ? 'Автоочистка выполненных задач' : 'Auto-cleanup completed tasks'}
        </h4>

        <Row label={lang === 'ru' ? 'Включить' : 'Enable'}>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autocleanupEnabled}
              onChange={(e) => setAutocleanupEnabled(e.target.checked)}
              className="w-4 h-4 accent-[var(--color-accent)]"
            />
            <span className="text-[13px] text-muted">
              {lang === 'ru'
                ? 'Автоматически архивировать выполненные задачи при запуске'
                : 'Auto-archive completed tasks on startup'}
            </span>
          </label>
        </Row>

        {/* v0.9.30: выбор режима */}
        <Row label={tr(lang, 'autoclean_mode_label')}>
          <div className="flex flex-col gap-1.5">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="autoclean_mode"
                value="weekday"
                checked={autocleanupMode === 'weekday'}
                onChange={() => setAutocleanupMode('weekday')}
                disabled={!autocleanupEnabled}
                className="accent-[var(--color-accent)]"
              />
              <span className="text-[13px]">{tr(lang, 'autoclean_mode_weekday')}</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="autoclean_mode"
                value="age"
                checked={autocleanupMode === 'age'}
                onChange={() => setAutocleanupMode('age')}
                disabled={!autocleanupEnabled}
                className="accent-[var(--color-accent)]"
              />
              <span className="text-[13px]">{tr(lang, 'autoclean_mode_age')}</span>
            </label>
          </div>
        </Row>

        {autocleanupMode === 'weekday' && (
          <Row label={lang === 'ru' ? 'День недели' : 'Day of week'}>
            <select
              value={autocleanupDay}
              onChange={(e) => setAutocleanupDay(parseInt(e.target.value, 10))}
              disabled={!autocleanupEnabled}
              className="bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px] disabled:opacity-50"
            >
              {dayNames.map((n, i) => (
                <option key={i} value={i}>{n}</option>
              ))}
            </select>
          </Row>
        )}

        {autocleanupMode === 'age' && (
          <Row label={lang === 'ru' ? 'Старше, дней' : 'Older than, days'}>
            <input
              type="number"
              min={1}
              max={365}
              value={autocleanupMinAgeDays}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setAutocleanupMinAgeDays(v);
              }}
              disabled={!autocleanupEnabled}
              className="bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px] w-24 disabled:opacity-50"
            />
          </Row>
        )}

        <div className="text-[11px] text-muted mt-1 mb-3 leading-relaxed">
          {autocleanupMode === 'weekday'
            ? tr(lang, 'autoclean_mode_weekday_hint')
            : tr(lang, 'autoclean_mode_age_hint')}
        </div>

        <Row label={lang === 'ru' ? 'Сейчас' : 'Now'}>
          <button
            type="button"
            onClick={() => setCleanNowConfirm(true)}
            className="px-3 py-1 text-[13px] border border-border-soft rounded hover:bg-surface-alt"
          >
            {lang === 'ru' ? 'Почистить сейчас' : 'Clean up now'}
          </button>
        </Row>

        <div className="text-[11px] text-muted mt-2 leading-relaxed">
          {tr(lang, 'autoclean_now_hint')}
        </div>
      </div>

      <ConfirmDialog
        open={cleanNowConfirm}
        title={lang === 'ru' ? 'Почистить сейчас?' : 'Clean up now?'}
        message={lang === 'ru'
          ? 'Все выполненные задачи будут перенесены в архив — без учёта возраста и дня недели. Они останутся в Статистике со статусом «Выполнено», будет 10 секунд на Undo.'
          : 'All completed tasks will be moved to archive — regardless of age and weekday. They remain in Stats with «Done» status, and you have 10 seconds to Undo.'}
        confirmLabel={lang === 'ru' ? 'Почистить' : 'Clean up'}
        cancelLabel={tr(lang, 'cancel')}
        onConfirm={() => { handleCleanNow(); setCleanNowConfirm(false); }}
        onCancel={() => setCleanNowConfirm(false)}
      />

      {/* v0.9.35-dev.6.7: Сбор статистики перенесён внутрь вкладки Общее */}
      <InlineStatsToggle lang={lang} />
    </div>
  );
}

/** Сбор статистики — встроенный в GeneralSection (v0.9.35-dev.6.7) */
function InlineStatsToggle({ lang }: { lang: string }) {
  const enabled = useStore(s => s.statsEnabled);
  const setEnabled = useStore(s => s.setStatsEnabled);
  return (
    <div className="bg-surface-alt border border-border-soft rounded-lg p-4">
      <h4 className="font-display text-[14px] font-semibold mb-3">
        {lang === 'ru' ? 'Сбор статистики' : 'Usage statistics'}
      </h4>
      <Row label={lang === 'ru' ? 'Включить' : 'Enable'}>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="w-4 h-4 accent-[var(--color-accent)]"
          />
          <span className="text-[13px] text-muted">
            {lang === 'ru'
              ? 'Собирать анонимную статистику использования'
              : 'Collect anonymous usage statistics'}
          </span>
        </label>
      </Row>
    </div>
  );
}

function TagsSection() {
  const lang = useStore(s => s.language);
  const tags = useStore(s => s.tags);
  const addTag = useStore(s => s.addTag);
  const updateTag = useStore(s => s.updateTag);
  const deleteTag = useStore(s => s.deleteTag);

  const [confirmId, setConfirmId] = useState<number | null>(null);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_tags')}</h3>
        <button
          onClick={() => addTag('NEW' + (tags.length + 1), '#5B7FB8')}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
        >
          <Plus className="w-4 h-4" />
          {lang === 'ru' ? 'Добавить тэг' : 'Add tag'}
        </button>
      </div>
      <div className="border border-border-soft rounded-lg max-h-[60vh] overflow-y-auto bg-surface">
        {tags.map(t => (
          <div key={t.id} className="flex items-center gap-3 px-3 py-2 border-b border-border-soft last:border-b-0">
            <input
              type="color" value={t.color}
              onChange={(e) => updateTag(t.id, { color: e.target.value })}
              className="w-7 h-7 border-0 bg-transparent cursor-pointer"
            />
            <input
              value={t.name}
              onChange={(e) => updateTag(t.id, { name: e.target.value })}
              className="flex-1 bg-transparent border-0 outline-none text-[13px] font-mono uppercase"
            />
            <button
              onClick={() => setConfirmId(t.id)}
              className="p-1 text-muted hover:text-[var(--status-important)]"
            ><Trash2 size={14} /></button>
          </div>
        ))}
        {tags.length === 0 && <div className="px-3 py-8 text-center text-muted text-[13px]">—</div>}
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        title={lang === 'ru' ? 'Удалить тэг?' : 'Delete tag?'}
        message={lang === 'ru' ? 'Тэг будет удалён из всех задач.' : 'The tag will be removed from all tasks.'}
        confirmLabel={tr(lang, 'delete')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { if (confirmId !== null) deleteTag(confirmId); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}

function StatusesSection() {
  const lang = useStore(s => s.language);
  const statuses = useStore(s => s.statuses);
  const addStatus = useStore(s => s.addStatus);
  const updateStatus = useStore(s => s.updateStatus);
  const deleteStatus = useStore(s => s.deleteStatus);
  const reorderStatuses = useStore(s => s.reorderStatuses);

  const [confirmId, setConfirmId] = useState<number | null>(null);

  const nonTech = statuses.filter(s => s.is_technical !== 1);

  const move = (i: number, dir: -1 | 1) => {
    const ids = statuses.map(s => s.id);
    const fullIdx = statuses.findIndex(s => s.id === nonTech[i]?.id);
    const j = fullIdx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[fullIdx], ids[j]] = [ids[j], ids[fullIdx]];
    reorderStatuses(ids);
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_statuses')}</h3>
        <button
          onClick={() => addStatus('Новый', '#5B7FB8', 'middle')}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
        >
          <Plus className="w-4 h-4" />
          {lang === 'ru' ? 'Добавить статус' : 'Add status'}
        </button>
      </div>
      <div className="border border-border-soft rounded-lg max-h-[60vh] overflow-y-auto bg-surface">
        {nonTech.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 px-3 py-2 border-b border-border-soft last:border-b-0">
            <div className="flex flex-col">
              <button onClick={() => move(i, -1)} className="text-muted hover:text-text leading-none text-[10px]">▲</button>
              <button onClick={() => move(i, 1)} className="text-muted hover:text-text leading-none text-[10px]">▼</button>
            </div>
            <GripVertical size={14} className="text-faint" />
            <input
              type="color" value={s.color}
              onChange={(e) => updateStatus(s.id, { color: e.target.value })}
              className="w-7 h-7 border-0 bg-transparent cursor-pointer"
            />
            <input
              value={s.name}
              onChange={(e) => updateStatus(s.id, { name: e.target.value })}
              className="flex-1 bg-transparent border-0 outline-none text-[13px]"
            />
            {/* Task 8: TWO independent checkboxes: hidden + default_collapsed */}
            <label className="flex items-center gap-1 text-[11px] text-muted cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={!!s.hidden}
                onChange={(e) => updateStatus(s.id, { hidden: e.target.checked ? 1 : 0 })}
                className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
              />
              {lang === 'ru' ? 'Скрытый' : 'Hidden'}
            </label>
            <label className="flex items-center gap-1 text-[11px] text-muted cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={!!s.default_collapsed}
                onChange={(e) => updateStatus(s.id, { default_collapsed: e.target.checked ? 1 : 0 })}
                className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
              />
              {lang === 'ru' ? 'Свёрнут' : 'Collapsed'}
            </label>
            {/* v0.8.11: статус «Выполнено» (behavior=archive, non-technical) системный и неудаляемый —
                без него сломается кнопка-галочка выполнения в карточке задачи. */}
            {s.behavior === 'archive' ? (
              <span
                className="text-[10px] text-muted px-1.5 py-0.5 rounded border border-border-soft shrink-0"
                title={lang === 'ru'
                  ? 'Системный статус — не удаляется'
                  : 'System status — cannot be deleted'}
              >
                {lang === 'ru' ? 'системный' : 'system'}
              </span>
            ) : (
              <button
                onClick={() => setConfirmId(s.id)}
                className="p-1 text-muted hover:text-[var(--status-important)]"
              ><Trash2 size={14} /></button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted mt-2">
        {lang === 'ru'
          ? '«Скрытый» — статус не показывается на доске задач. «Свёрнут» — секция свёрнута по умолчанию. Статус «Выполнено» — системный и не удаляется.'
          : '"Hidden" — status is hidden from the task board. "Collapsed" — section is collapsed by default. "Done" is a system status and cannot be deleted.'}
      </p>

      <ConfirmDialog
        open={confirmId !== null}
        title={lang === 'ru' ? 'Удалить статус?' : 'Delete status?'}
        message={lang === 'ru' ? 'Задачи с этим статусом потеряют его.' : 'Tasks with this status will lose it.'}
        confirmLabel={tr(lang, 'delete')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { if (confirmId !== null) deleteStatus(confirmId); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}

function StatsToggleSection() {
  const lang = useStore(s => s.language);
  const enabled = useStore(s => s.statsEnabled);
  const setEnabled = useStore(s => s.setStatsEnabled);

  return (
    <div className="max-w-xl space-y-4">
      <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_stats')}</h3>
      <label className="flex items-center gap-3 cursor-pointer">
        <button
          type="button"
          onClick={() => setEnabled(!enabled)}
          aria-pressed={enabled}
          className={'w-10 h-6 rounded-full relative transition-colors shrink-0 ' + (enabled ? 'bg-accent' : 'bg-border')}
        >
          <span
            className="absolute bg-white w-5 h-5 rounded-full transition-transform shadow"
            style={{ top: '50%', left: 0, transform: `translateY(-50%) translateX(${enabled ? 18 : 2}px)` }}
          />
        </button>
        <span className="text-[13.5px]">{tr(lang, 'enable_stats')}</span>
      </label>
      <p className="text-[12px] text-muted">
        {lang === 'ru' ? 'Когда выключено — вкладка «Статистика» скрыта.' : 'When disabled, the Statistics tab is hidden.'}
      </p>
    </div>
  );
}

function ThemeSection() {
  const lang = useStore(s => s.language);
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);
  // v0.9.29: кастом-тема
  const customAccent = useStore(s => s.customThemeAccent);
  const customBg = useStore(s => s.customThemeBg);
  const customText = useStore(s => s.customThemeText);
  const setCustomThemeColor = useStore(s => s.setCustomThemeColor);

  const themes: { key: ThemeName; label: string; icon: any; preview: { bg: string; surface: string; accent: string; text: string } }[] = [
    { key: 'light', label: tr(lang, 'theme_light'), icon: Sun, preview: { bg: '#F7F6F2', surface: '#FBFBF9', accent: '#5B7FB8', text: '#28251D' } },
    { key: 'dark', label: tr(lang, 'theme_dark'), icon: Moon, preview: { bg: '#171614', surface: '#1C1B19', accent: '#7FA0D4', text: '#CDCCCA' } },
    { key: 'akatsuki', label: tr(lang, 'theme_akatsuki'), icon: Sparkles, preview: { bg: '#0D0B0F', surface: '#15121A', accent: '#A0212B', text: '#E8E2EE' } },
    { key: 'konoha', label: tr(lang, 'theme_konoha'), icon: Leaf, preview: { bg: '#F4EDD8', surface: '#FAF5E3', accent: '#5B8C3E', text: '#2D2818' } },
    // v0.9.29: 5-й пресет — кастомная тема с текущими выбранными цветами в preview
    { key: 'custom', label: tr(lang, 'theme_custom'), icon: Palette, preview: { bg: customBg, surface: customBg, accent: customAccent, text: customText } },
  ];

  const resetCustom = () => {
    setCustomThemeColor('accent', '#5B7FB8');
    setCustomThemeColor('bg', '#F7F6F2');
    setCustomThemeColor('text', '#28251D');
  };

  return (
    <div className="max-w-3xl">
      <h3 className="font-display text-[16px] font-semibold mb-4">{tr(lang, 'settings_theme')}</h3>
      <div className="grid grid-cols-2 gap-3">
        {themes.map(t => {
          const Ic = t.icon;
          const active = theme === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTheme(t.key)}
              className={'text-left rounded-xl border-2 p-3 transition-all relative ' +
                (active ? 'border-accent' : 'border-border-soft hover:border-border')}
            >
              <div
                className="rounded-lg p-3 mb-2.5 flex items-center gap-2"
                style={{ background: t.preview.bg, color: t.preview.text }}
              >
                <Ic size={14} />
                <span className="text-[12px] font-medium">{t.label}</span>
                <div className="ml-auto flex gap-1">
                  <span className="w-3 h-3 rounded-full" style={{ background: t.preview.surface, border: `1px solid ${t.preview.text}33` }} />
                  <span className="w-3 h-3 rounded-full" style={{ background: t.preview.accent }} />
                  <span className="w-3 h-3 rounded-full" style={{ background: t.preview.text }} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">{t.label}</span>
                {active && <Check size={14} className="text-accent" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* v0.9.30: 3 color-picker — мобильный 1 кол., широкий sm+ = 3. Свободный ColorPickerField без вылетов. */}
      {theme === 'custom' && (
        <div className="mt-5 rounded-xl border border-border-soft bg-surface p-4">
          <p className="text-[12px] text-muted mb-3">{tr(lang, 'theme_custom_hint')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ColorPickerField
              label={tr(lang, 'theme_custom_accent')}
              value={customAccent}
              onChange={hex => setCustomThemeColor('accent', hex)}
            />
            <ColorPickerField
              label={tr(lang, 'theme_custom_bg')}
              value={customBg}
              onChange={hex => setCustomThemeColor('bg', hex)}
            />
            <ColorPickerField
              label={tr(lang, 'theme_custom_text')}
              value={customText}
              onChange={hex => setCustomThemeColor('text', hex)}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={resetCustom}
              className="text-[12px] text-muted hover:text-text transition-colors"
            >
              {tr(lang, 'theme_custom_reset')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// v0.9.30: color-picker — квадратный swatch (видимый образец цвета) + скрытый native picker внутри.
// Плюс hex-текстовое поле. Стабильно выглядит в Tauri WebView2 без вылетов.
function ColorPickerField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const safeValue = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000';
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[11px] text-muted uppercase tracking-wide">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="relative inline-block w-9 h-9 flex-shrink-0 rounded-md border border-border-soft overflow-hidden cursor-pointer"
          style={{ backgroundColor: safeValue }}
          title={label}
        >
          <input
            type="color"
            value={safeValue}
            onChange={e => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            aria-label={label}
          />
        </span>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 min-w-0 h-9 px-2 text-[12px] rounded-md border border-border-soft bg-bg text-text focus:outline-none focus:border-accent font-mono uppercase"
          maxLength={7}
          spellCheck={false}
        />
      </div>
    </label>
  );
}

// ─── Import helpers ───────────────────────────────────────────────────────────
interface ImportedTask {
  title: string;
  comment?: string;
  tag?: string;
  tags?: string; // comma-separated tags from XLSX template
  status?: string;
  start_date?: string;
  deadline?: string;
  due_date?: string; // alias for deadline in XLSX template
  finish_date?: string;
}

function normalizeImported(rows: Record<string, any>[]): ImportedTask[] {
  return rows.map(r => {
    // Task 9a: support XLSX template columns: title, description, status, tags, due_date, created_at
    const title = r['title'] ?? r['Название'] ?? r['Задача'] ?? '';
    const comment = r['description'] ?? r['comment'] ?? r['Комментарий'] ?? '';
    // tags column (comma-separated) or tag column
    const tags = r['tags'] ?? r['tag'] ?? r['Тэг'] ?? '';
    const status = r['status'] ?? r['Статус'] ?? '';
    const start_date = r['created_at'] ?? r['start_date'] ?? r['Старт'] ?? '';
    const deadline = r['due_date'] ?? r['deadline'] ?? r['Дедлайн'] ?? '';
    const finish_date = r['finish_date'] ?? r['Финиш'] ?? '';
    return { title, comment, tags, status, start_date, deadline, finish_date };
  }).filter(t => t.title);
}

function IOSection() {
  const lang = useStore(s => s.language);
  const pushToast = useStore(s => s.pushToast);
  const statuses = useStore(s => s.statuses);
  const tags = useStore(s => s.tags);
  const addTag = useStore(s => s.addTag);
  const addTask = useStore(s => s.addTask);
  const tasks = useStore(s => s.tasks);
  const refresh = useStore(s => s.refresh);

  // ─── Export state ─────────────────────────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'csv' | 'xlsx' | null>(null);
  const [exportInc, setExportInc] = useState({ tasks: true, tags: true, statuses: true });

  const openExportDialog = (format: 'json' | 'csv' | 'xlsx') => {
    setExportFormat(format);
    setExportInc({ tasks: true, tags: true, statuses: true });
    setExportOpen(true);
  };

  const doExport = () => {
    if (!exportFormat) return;
    const payload = buildBackup(exportInc);
    const stamp = todayISO(useStore.getState().timezone);
    if (exportFormat === 'json') {
      downloadFile(`taskflow-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
    } else if (exportFormat === 'csv') {
      // CSV: один файл, секции через пустую строку и заголовок
      const parts: string[] = [];
      if (payload.statuses?.length) {
        parts.push('# STATUSES');
        parts.push(['id', 'name', 'color', 'behavior', 'sort_order', 'hidden', 'default_collapsed', 'is_technical'].join(','));
        for (const s of payload.statuses) {
          parts.push([s.id, s.name, s.color, s.behavior, s.sort_order, s.hidden ?? 0, s.default_collapsed ?? 0, s.is_technical ?? 0]
            .map(csvEscape).join(','));
        }
        parts.push('');
      }
      if (payload.tags?.length) {
        parts.push('# TAGS');
        parts.push(['id', 'name', 'color', 'sort_order'].join(','));
        for (const t of payload.tags) parts.push([t.id, t.name, t.color, t.sort_order].map(csvEscape).join(','));
        parts.push('');
      }
      if (payload.tasks?.length) {
        parts.push('# TASKS');
        parts.push(['id', 'title', 'comment', 'tag_id', 'status_id', 'start_date', 'deadline', 'finish_date', 'archived', 'created_at', 'updated_at'].join(','));
        for (const t of payload.tasks) parts.push([t.id, t.title, t.comment, t.tag_id, t.status_id, t.start_date, t.deadline, t.finish_date, t.archived, t.created_at, t.updated_at].map(csvEscape).join(','));
      }
      downloadFile(`taskflow-${stamp}.csv`, parts.join('\n'), 'text/csv');
    } else if (exportFormat === 'xlsx') {
      const wb = XLSX.utils.book_new();
      if (payload.statuses?.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payload.statuses), 'Statuses');
      if (payload.tags?.length)     XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payload.tags), 'Tags');
      if (payload.tasks?.length)    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payload.tasks), 'Tasks');
      XLSX.writeFile(wb, `taskflow-${stamp}.xlsx`);
    }
    pushToast(tr(lang, 'exported'));
    setExportOpen(false);
    setExportFormat(null);
  };

  // ─── Import state ─────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Простой импорт задач (старый, для XLSX-таблиц со столбцами)
  const [preview, setPreview] = useState<{ rows: ImportedTask[]; filename: string } | null>(null);
  // Полный импорт backup-JSON (новый, v0.8.7)
  const [backupPreview, setBackupPreview] = useState<{ payload: BackupPayload; filename: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmBackupReplace, setConfirmBackupReplace] = useState(false);

  /** Download XLSX import template */
  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['title', 'description', 'status', 'tags', 'due_date', 'created_at'],
      ['Пример задачи', 'Описание задачи', 'В работе', 'dev', todayISO(useStore.getState().timezone), todayISO(useStore.getState().timezone)],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
    XLSX.writeFile(wb, 'taskflow_import_template.xlsx');
    pushToast(lang === 'ru' ? 'Шаблон скачан' : 'Template downloaded');
  };

  const parseFile = async (file: File): Promise<{ kind: 'backup'; payload: BackupPayload } | { kind: 'tasks'; rows: ImportedTask[] }> => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'json') {
      const text = await file.text();
      const data = JSON.parse(text);
      // v0.8.7 backup format: object with version + statuses/tags/tasks
      if (data && typeof data === 'object' && !Array.isArray(data) && (data.version || data.statuses || data.tags)) {
        return { kind: 'backup', payload: data as BackupPayload };
      }
      const rows = Array.isArray(data) ? data : (data.tasks ?? []);
      return { kind: 'tasks', rows: normalizeImported(rows) };
    }
    if (ext === 'csv') {
      const text = await file.text();
      // v0.8.7 backup CSV: имеет секции # STATUSES / # TAGS / # TASKS
      if (text.includes('# TASKS') || text.includes('# STATUSES') || text.includes('# TAGS')) {
        return { kind: 'backup', payload: parseBackupCsv(text) };
      }
      return new Promise((resolve, reject) => {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (res) => resolve({ kind: 'tasks', rows: normalizeImported(res.data as Record<string, any>[]) }),
          error: reject,
        });
      });
    }
    if (ext === 'xlsx' || ext === 'xls') {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      // v0.8.7 backup XLSX: несколько листов Statuses/Tags/Tasks
      const sheetNames = wb.SheetNames.map(n => n.toLowerCase());
      if (sheetNames.includes('statuses') || sheetNames.includes('tags') || (sheetNames.includes('tasks') && sheetNames.length > 1)) {
        const payload: BackupPayload = { version: 'xlsx', exported_at: new Date().toISOString() };
        for (const name of wb.SheetNames) {
          const data = XLSX.utils.sheet_to_json<any>(wb.Sheets[name]);
          if (name.toLowerCase() === 'statuses') payload.statuses = data;
          else if (name.toLowerCase() === 'tags') payload.tags = data;
          else if (name.toLowerCase() === 'tasks') payload.tasks = data;
        }
        return { kind: 'backup', payload };
      }
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
      return { kind: 'tasks', rows: normalizeImported(rows) };
    }
    throw new Error('Unsupported file format');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseFile(file);
      if (parsed.kind === 'backup') {
        setBackupPreview({ payload: parsed.payload, filename: file.name });
        setPreview(null);
      } else {
        setPreview({ rows: parsed.rows, filename: file.name });
        setBackupPreview(null);
      }
    } catch (err) {
      pushToast('Ошибка парсинга файла: ' + String(err));
    }
    e.target.value = '';
  };

  // Old simple-tasks import path
  const resolveTagId = (tagStr: string): number | null => {
    if (!tagStr) return null;
    const firstName = tagStr.split(',')[0].trim();
    if (!firstName) return null;
    const existing = tags.find(tg => tg.name.toLowerCase() === firstName.toLowerCase());
    if (existing) return existing.id;
    return addTag(firstName.toUpperCase(), '#5B7FB8');
  };

  const resolveTaskFields = (t: ImportedTask) => {
    // v0.8.8: fallback для импорта — «Взять в работу» (по уточнению пользователя).
    // Если нет «Взять в работу» — фоллбэк на первый top/middle, затем на любой первый.
    const defaultStatus =
      statuses.find(s => s.name === 'Взять в работу')
      ?? statuses.find(s => s.behavior === 'top' || s.behavior === 'middle');
    const statusMatch = t.status
      ? statuses.find(s => s.name.toLowerCase() === t.status!.trim().toLowerCase())
      : null;
    const tagStr = t.tags ?? t.tag ?? '';
    const tagId = resolveTagId(tagStr);
    const today = new Date().toISOString();
    return {
      title: t.title,
      comment: t.comment ?? '',
      tag_id: tagId,
      status_id: statusMatch?.id ?? defaultStatus?.id ?? (statuses[0]?.id ?? 1),
      start_date: t.start_date || today.slice(0, 10),
      deadline: t.deadline || null,
      finish_date: t.finish_date || null,
    };
  };

  const doImport = async (replace: boolean) => {
    if (!preview) return;
    if (replace) {
      const softDelete = useStore.getState().softDeleteTask;
      for (const t of tasks) softDelete(t.id);
    }
    setImporting(true);
    let count = 0;
    for (const row of preview.rows) {
      addTask(resolveTaskFields(row));
      count++;
    }
    setImporting(false);
    setPreview(null);
    pushToast(`${tr(lang, 'imported_n')} ${count} ${tr(lang, 'import_rows')}`);
  };

  // v0.8.7 — backup import
  const doBackupImport = async (mode: 'replace' | 'merge') => {
    if (!backupPreview) return;
    setImporting(true);
    try {
      const counts = await applyBackup(backupPreview.payload, mode);
      await useStore.getState().init();
      refresh();
      const total = counts.statuses + counts.tags + counts.tasks + counts.templates;
      pushToast(lang === 'ru'
        ? `Импортировано: ${counts.tasks} задач, ${counts.tags} тэгов, ${counts.statuses} статусов, ${counts.templates} шаблонов (всего ${total})`
        : `Imported: ${counts.tasks} tasks, ${counts.tags} tags, ${counts.statuses} statuses, ${counts.templates} templates (total ${total})`);
    } catch (e) {
      console.error('backup import error:', e);
      logger.error('backup import failed', { error: String(e) });
      pushToast(lang === 'ru' ? 'Ошибка импорта: ' + String(e) : 'Import error: ' + String(e));
    }
    setImporting(false);
    setBackupPreview(null);
  };

  return (
    <div className="max-w-xl space-y-6">
      <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_io')}</h3>

      {/* Export */}
      <div>
        <div className="text-[12px] text-muted uppercase tracking-wider mb-2">
          {lang === 'ru' ? 'Экспорт' : 'Export'}
        </div>
        {/* v0.8.8: CSV-экспорт убран (некорректно подтягивались статусы при импорте). Остались JSON и XLSX. */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => openExportDialog('json')} className="flex items-center justify-center gap-2 px-4 py-3 border border-border-soft rounded-lg hover:bg-surface-alt text-[13px]">
            <Download size={16} /> JSON
          </button>
          <button onClick={() => openExportDialog('xlsx')} className="flex items-center justify-center gap-2 px-4 py-3 border border-border-soft rounded-lg hover:bg-surface-alt text-[13px]">
            <Download size={16} /> XLSX
          </button>
        </div>
      </div>

      {/* Import */}
      <div>
        <div className="text-[12px] text-muted uppercase tracking-wider mb-2">{tr(lang, 'import_tasks')}</div>
        <div className="border border-border-soft rounded-lg p-4 space-y-3 bg-surface">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center gap-2 px-4 py-2.5 border border-dashed border-border rounded-lg hover:bg-surface-alt text-[13px] justify-center"
            >
              <Upload size={15} />
              {tr(lang, 'import_json_csv_xlsx')}
            </button>
            <button
              onClick={handleDownloadTemplate}
              title={lang === 'ru' ? 'Скачать шаблон XLSX' : 'Download XLSX template'}
              className="flex items-center gap-1.5 px-3 py-2 border border-border-soft rounded-lg hover:bg-surface-alt text-[12px] shrink-0"
            >
              <Download size={14} />
              {lang === 'ru' ? 'Шаблон' : 'Template'}
            </button>
          </div>

          {/* Old simple-tasks preview */}
          {preview && (
            <div className="space-y-3">
              <div className="text-[12px] text-muted">
                <span className="font-medium text-text">{preview.filename}</span>
                {' '}— {tr(lang, 'import_preview')}: {preview.rows.length} {tr(lang, 'import_rows')}
              </div>
              <div className="max-h-[300px] overflow-y-auto border border-border-soft rounded">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-surface-alt">
                    <tr>
                      <th className="text-left px-2 py-1 text-muted font-medium">#</th>
                      <th className="text-left px-2 py-1 text-muted font-medium">{lang === 'ru' ? 'Название' : 'Title'}</th>
                      <th className="text-left px-2 py-1 text-muted font-medium">{lang === 'ru' ? 'Статус' : 'Status'}</th>
                      <th className="text-left px-2 py-1 text-muted font-medium">{lang === 'ru' ? 'Тэг' : 'Tag'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i} className="border-t border-border-soft">
                        <td className="px-2 py-1 text-muted">{i + 1}</td>
                        <td className="px-2 py-1 truncate max-w-[200px]">{r.title}</td>
                        <td className="px-2 py-1 text-muted">{r.status || '—'}</td>
                        <td className="px-2 py-1 text-muted">{r.tags || r.tag || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => doImport(false)}
                  disabled={importing}
                  className="flex-1 px-3 py-2 text-[12px] bg-accent text-white rounded-md hover:bg-accent-hover font-medium disabled:opacity-50"
                >
                  {tr(lang, 'import_add')}
                </button>
                <button
                  onClick={() => setConfirmReplace(true)}
                  disabled={importing}
                  className="flex-1 px-3 py-2 text-[12px] border border-[var(--status-important)] text-[var(--status-important)] rounded-md hover:bg-[var(--status-important)] hover:text-white font-medium disabled:opacity-50"
                >
                  {tr(lang, 'import_replace')}
                </button>
              </div>
              <button onClick={() => setPreview(null)} className="text-[11px] text-muted hover:text-text">
                {tr(lang, 'cancel')}
              </button>
            </div>
          )}

          {/* v0.8.7 — full backup preview */}
          {backupPreview && (
            <div className="space-y-3">
              <div className="text-[12px] text-muted">
                <span className="font-medium text-text">{backupPreview.filename}</span>
                {' '}— {lang === 'ru' ? 'Резервная копия' : 'Backup'}
                {backupPreview.payload.version ? ` v${backupPreview.payload.version}` : ''}
              </div>
              <div className="px-3 py-2 border border-border-soft rounded bg-surface-alt text-[12px] space-y-1">
                {(['statuses', 'tags', 'tasks'] as const).map(k => (
                  <div key={k} className="flex justify-between">
                    <span className="capitalize">{k}</span>
                    <span className="text-muted">{backupPreview.payload[k]?.length ?? 0}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => doBackupImport('merge')}
                  disabled={importing}
                  className="flex-1 px-3 py-2 text-[12px] bg-accent text-white rounded-md hover:bg-accent-hover font-medium disabled:opacity-50"
                >
                  {lang === 'ru' ? 'Слить (добавить новое)' : 'Merge (add new)'}
                </button>
                <button
                  onClick={() => setConfirmBackupReplace(true)}
                  disabled={importing}
                  className="flex-1 px-3 py-2 text-[12px] border border-[var(--status-important)] text-[var(--status-important)] rounded-md hover:bg-[var(--status-important)] hover:text-white font-medium disabled:opacity-50"
                >
                  {lang === 'ru' ? 'Заменить всё' : 'Replace all'}
                </button>
              </div>
              <button onClick={() => setBackupPreview(null)} className="text-[11px] text-muted hover:text-text">
                {tr(lang, 'cancel')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Export dialog: pick entities */}
      <ConfirmDialog
        open={exportOpen}
        title={lang === 'ru' ? `Экспорт в ${(exportFormat ?? '').toUpperCase()}` : `Export to ${(exportFormat ?? '').toUpperCase()}`}
        message=""
        confirmLabel={lang === 'ru' ? 'Экспортировать' : 'Export'}
        cancelLabel={tr(lang, 'cancel')}
        onConfirm={doExport}
        onCancel={() => { setExportOpen(false); setExportFormat(null); }}
      >
        <div className="space-y-2 mt-2 text-[13px]">
          <div className="text-muted text-[12px] mb-1">
            {lang === 'ru' ? 'Что включить в файл:' : 'What to include:'}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={exportInc.tasks} onChange={e => setExportInc(p => ({ ...p, tasks: e.target.checked }))} />
            <span>{lang === 'ru' ? 'Задачи' : 'Tasks'} <span className="text-muted">({tasks.length})</span></span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={exportInc.tags} onChange={e => setExportInc(p => ({ ...p, tags: e.target.checked }))} />
            <span>{lang === 'ru' ? 'Тэги' : 'Tags'} <span className="text-muted">({tags.length})</span></span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={exportInc.statuses} onChange={e => setExportInc(p => ({ ...p, statuses: e.target.checked }))} />
            <span>{lang === 'ru' ? 'Статусы' : 'Statuses'} <span className="text-muted">({statuses.length})</span></span>
          </label>
        </div>
      </ConfirmDialog>

      {/* Confirm replace (simple tasks) */}
      <ConfirmDialog
        open={confirmReplace}
        title={lang === 'ru' ? 'Заменить все задачи?' : 'Replace all tasks?'}
        message={tr(lang, 'import_confirm_replace')}
        confirmLabel={tr(lang, 'import_replace')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { setConfirmReplace(false); doImport(true); }}
        onCancel={() => setConfirmReplace(false)}
      />

      {/* Confirm replace (full backup) */}
      <ConfirmDialog
        open={confirmBackupReplace}
        title={lang === 'ru' ? 'Заменить все данные?' : 'Replace all data?'}
        message={lang === 'ru'
          ? 'Выбранные сущности из файла полностью заменят текущие данные. Это действие необратимо. Продолжить?'
          : 'Selected entities from the file will completely replace your current data. This cannot be undone. Continue?'}
        confirmLabel={lang === 'ru' ? 'Заменить' : 'Replace'}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { setConfirmBackupReplace(false); doBackupImport('replace'); }}
        onCancel={() => setConfirmBackupReplace(false)}
      />
    </div>
  );
}

// CSV escape helper (used by export)
function csvEscape(v: any): string {
  const s = v == null ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Parse v0.8.7 backup CSV with # STATUSES / # TAGS / # TASKS sections
function parseBackupCsv(text: string): BackupPayload {
  const payload: BackupPayload = { version: 'csv', exported_at: new Date().toISOString() };
  const lines = text.split(/\r?\n/);
  let currentSection: 'statuses' | 'tags' | 'tasks' | null = null;
  let headers: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('# STATUSES')) { currentSection = 'statuses'; headers = []; payload.statuses = []; continue; }
    if (line.startsWith('# TAGS'))     { currentSection = 'tags';     headers = []; payload.tags = []; continue; }
    if (line.startsWith('# TASKS'))    { currentSection = 'tasks';    headers = []; payload.tasks = []; continue; }
    if (!currentSection) continue;
    // Simple CSV split (Papa would be more robust but the export is well-formed)
    const parsed = Papa.parse<string[]>(line, { header: false }).data[0] as string[];
    if (!headers.length) { headers = parsed; continue; }
    const row: any = {};
    headers.forEach((h, i) => { row[h] = parsed[i] ?? ''; });
    (payload[currentSection]! as any[]).push(row);
  }
  return payload;
}

// ─── Storage section ──────────────────────────────────────────────────────────
function StorageSection() {
  const lang = useStore(s => s.language);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pushToast = useStore(s => s.pushToast);
  const refresh = useStore(s => s.refresh);
  const isDesktop = isTauri();

  const [dangerStep, setDangerStep] = useState<0 | 1 | 2>(0);
  // v0.8.10: модалка «Требуется перезапуск» после смены пути БД
  const [restartModal, setRestartModal] = useState(false);
  // v0.8.11: путь к backup-файлу и статус ручного бэкапа
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  // v0.8.12: диагностика — путь к логу и текущая версия схемы БД
  const [logPath, setLogPath] = useState<string | null>(null);
  const [schemaVer, setSchemaVer] = useState<number | null>(null);

  const loadPath = async () => {
    if (!isDesktop) return;
    setLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string>('get_db_path');
      setDbPath(path);
    } catch (e) {
      console.error('get_db_path error:', e);
      setDbPath('(error loading path)');
    }
    setLoading(false);
  };

  useState(() => { loadPath(); });

  // v0.8.11: подгружаем ожидаемый путь резервной копии (обновляется при смене пути БД)
  const loadBackupPath = async () => {
    if (!isDesktop) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const p = await invoke<string>('get_backup_path');
      setBackupPath(p);
    } catch (e) {
      console.error('get_backup_path error:', e);
    }
  };
  useState(() => { loadBackupPath(); });

  // v0.8.11: создаём бэкап вручную — полезно перед опасными операциями (массовый импорт и т.п.)
  const handleBackupNow = async () => {
    if (!isDesktop) return;
    setBackupBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const p = await invoke<string>('backup_db');
      setBackupPath(p);
      pushToast(lang === 'ru' ? 'Резервная копия создана' : 'Backup created');
    } catch (e) {
      console.error('backup_db error:', e);
      logger.error('backup_db failed', { error: String(e) });
      pushToast(lang === 'ru' ? 'Не удалось создать резервную копию: ' + String(e) : 'Backup failed: ' + String(e));
    }
    setBackupBusy(false);
  };

  // v0.8.11: открыть папку с бэкапом (та же папка, что и data.db)
  const handleOpenBackupFolder = async () => {
    if (!isDesktop || !backupPath) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_in_explorer', { path: backupPath });
    } catch (e) {
      console.error('open_in_explorer error:', e);
      pushToast(lang === 'ru' ? 'Не удалось открыть папку: ' + String(e) : 'Failed to open folder: ' + String(e));
    }
  };

  // v0.8.12: Диагностика — подгружаем путь к логу и версию схемы
  const loadDiagnostics = async () => {
    if (!isDesktop) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const p = await invoke<string>('get_log_path');
      setLogPath(p);
    } catch (e) {
      console.error('get_log_path error:', e);
      setLogPath('(error)');
    }
    try {
      const v = await getSchemaVersion();
      setSchemaVer(v);
    } catch (e) {
      console.error('getSchemaVersion error:', e);
      setSchemaVer(null);
    }
  };
  useState(() => { loadDiagnostics(); });

  const handleOpenLog = async () => {
    if (!isDesktop || !logPath) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_in_explorer', { path: logPath });
    } catch (e) {
      console.error('open log error:', e);
      pushToast(lang === 'ru' ? 'Не удалось открыть лог: ' + String(e) : 'Failed to open log: ' + String(e));
    }
  };

  const handleClearLog = async () => {
    if (!isDesktop) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('clear_log');
      logger.info('log cleared by user');
      pushToast(lang === 'ru' ? 'Лог очищен' : 'Log cleared');
    } catch (e) {
      console.error('clear_log error:', e);
      pushToast(lang === 'ru' ? 'Не удалось очистить лог: ' + String(e) : 'Failed to clear log: ' + String(e));
    }
  };

  const handleChoose = async () => {
    if (!isDesktop) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        const { invoke } = await import('@tauri-apps/api/core');
        // v0.8.10: оставляем «/» в join — Rust set_db_path сам нормализует под OS
        const newPath = String(selected).replace(/[\\/]$/, '') + '/taskflow.db';
        await invoke('set_db_path', { path: newPath });
        setDbPath(newPath);
        // v0.8.11: backup-путь сменился вместе с путём БД
        await loadBackupPath();
        // v0.8.10: просим перезапустить—без этого plugin-sql продолжит писать в старый файл
        setRestartModal(true);
      }
    } catch (e) {
      // Task 10: always log + show toast, don't silently swallow
      console.error('Dialog open error:', e);
      pushToast(lang === 'ru' ? 'Ошибка выбора пути: ' + String(e) : 'Path selection error: ' + String(e));
    }
  };

  const handleReset = async () => {
    if (!isDesktop) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_db_path', { path: '' });
    await loadPath();
    await loadBackupPath();
    // v0.8.10: сброс пути тоже требует перезапуска
    setRestartModal(true);
  };

  const handleRestart = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('restart_app');
    } catch (e) {
      console.error('restart_app error:', e);
      pushToast(lang === 'ru' ? 'Не удалось перезапустить. Закройте и запустите вручную.' : 'Restart failed. Please close and start the app manually.');
    }
  };

  // v0.8.9: открыть папку с БД в системном файловом менеджере
  const handleOpenFolder = async () => {
    if (!isDesktop || !dbPath) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_in_explorer', { path: dbPath });
    } catch (e) {
      console.error('open_in_explorer error:', e);
      pushToast(lang === 'ru' ? 'Не удалось открыть папку: ' + String(e) : 'Failed to open folder: ' + String(e));
    }
  };

  // v0.8.7: properly reset all data (both Tauri & web), then refresh store
  const handleDangerReset = async () => {
    try {
      await resetDatabase();
      await useStore.getState().init();
      useStore.getState().refresh();
      pushToast(lang === 'ru' ? 'Данные стёрты' : 'Data erased');
    } catch (e) {
      console.error('handleDangerReset error:', e);
      // Fallback: hard reload (so user sees a clean state at least)
      window.location.reload();
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <h3 className="font-display text-[16px] font-semibold flex items-center gap-2">
        <HardDrive size={16} />
        {tr(lang, 'storage_section')}
      </h3>

      {!isDesktop ? (
        <div className="px-4 py-3 border border-border-soft rounded-lg bg-surface-alt">
          <div className="text-[12px] text-muted">{tr(lang, 'db_path_label')}</div>
          <div className="text-[13px] font-mono mt-1">localStorage</div>
          {/* Task 10: Web fallback — explain that path selection is desktop-only */}
          <div className="text-[11px] text-muted mt-2">
            {lang === 'ru'
              ? 'Выбор пути доступен только в десктопном приложении.'
              : 'Path selection is only available in the desktop app.'}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-[12px] text-muted">{tr(lang, 'db_path_label')}</div>
          <div className="flex gap-2 items-center">
            <div className="flex-1 px-3 py-2 bg-surface-alt border border-border-soft rounded-lg text-[12px] font-mono truncate" title={dbPath ?? ''}>
              {loading ? '…' : (dbPath ?? '(loading)')}
            </div>
            <button
              onClick={handleOpenFolder}
              disabled={!dbPath || loading}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] border border-border-soft rounded-lg hover:bg-surface-alt disabled:opacity-50"
              title={lang === 'ru' ? 'Открыть папку с БД в проводнике' : 'Open folder in file manager'}
            >
              <FolderOpen size={13} />
              <span>{lang === 'ru' ? 'Открыть папку' : 'Open folder'}</span>
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleChoose}
              className="px-3 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
            >{tr(lang, 'db_path_choose')}</button>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt text-muted"
            >{tr(lang, 'db_path_reset')}</button>
          </div>

          {/* v0.8.9: блок-подсказка по хранению */}
          <div className="mt-2 px-3.5 py-3 rounded-lg border border-border-soft bg-surface-alt/60 text-[12px] leading-relaxed space-y-2">
            <div className="flex items-center gap-2 font-semibold text-text">
              <Info size={13} className="text-muted" />
              {lang === 'ru' ? 'Где хранятся ваши данные' : 'Where your data lives'}
            </div>
            {lang === 'ru' ? (
              <>
                <div className="text-muted">
                  TaskFlow хранит два файла в папке профиля пользователя:
                  <ul className="list-disc ml-5 mt-1 space-y-0.5">
                    <li><span className="font-mono text-text">data.db</span> — все задачи, тэги, статусы, настройки (SQLite)</li>
                    <li><span className="font-mono text-text">taskflow_config.json</span> — только путь к БД, если вы выбрали свой</li>
                  </ul>
                </div>
                <div className="text-muted">
                  На Windows это: <span className="font-mono text-text">%APPDATA%\TaskFlow</span> — открыть вручную можно через <span className="font-mono text-text">Win+R</span> → <span className="font-mono text-text">%APPDATA%\TaskFlow</span>.
                </div>
                {/* v0.8.11: «можно, но с оговорками» вместо простого запрета */}
                <div className="text-muted border-l-2 border-[var(--status-deadline-3-day)] pl-2.5 space-y-1">
                  <div className="text-text font-medium">☕ Облачная папка (OneDrive / Dropbox / Яндекс.Диск / Google Drive)</div>
                  <div>Можно, но с оговорками. SQLite держит файл открытым во время работы и использует WAL/SHM-сайдкары. Облачные клиенты могут:</div>
                  <ul className="list-disc ml-5 space-y-0.5">
                    <li>повредить базу, если синхронизация произойдёт в момент записи (особенно опасно для WAL);</li>
                    <li>создать конфликт версий, если открыть TaskFlow одновременно на двух ПК — SQLite не умеет «сливать» между машинами;</li>
                    <li>подвесить запуск, если файл «высвобождён» (online-only) — лечится отключением «По запросу» в OneDrive.</li>
                  </ul>
                  <div>Если всё же хранить в облаке: работайте только на одном ПК в один момент, выходите из приложения перед синхронизацией и регулярно делайте экспорт в JSON на локальный диск.</div>
                  <div>Надёжный способ синхронизации между ПК — <span className="text-text">Экспорт/Импорт</span> в формате JSON.</div>
                </div>
              </>
            ) : (
              <>
                <div className="text-muted">
                  TaskFlow stores two files in your user profile folder:
                  <ul className="list-disc ml-5 mt-1 space-y-0.5">
                    <li><span className="font-mono text-text">data.db</span> — all tasks, tags, statuses and settings (SQLite)</li>
                    <li><span className="font-mono text-text">taskflow_config.json</span> — only the DB path override, if you picked a custom one</li>
                  </ul>
                </div>
                <div className="text-muted">
                  On Windows that's <span className="font-mono text-text">%APPDATA%\TaskFlow</span> — you can open it manually via <span className="font-mono text-text">Win+R</span> → <span className="font-mono text-text">%APPDATA%\TaskFlow</span>.
                </div>
                {/* v0.8.11: nuanced cloud-folder guidance */}
                <div className="text-muted border-l-2 border-[var(--status-deadline-3-day)] pl-2.5 space-y-1">
                  <div className="text-text font-medium">☕ Cloud folder (OneDrive / Dropbox / Yandex.Disk / Google Drive)</div>
                  <div>Possible but with caveats. SQLite keeps the file open during runtime and uses WAL/SHM side files. Cloud clients may:</div>
                  <ul className="list-disc ml-5 space-y-0.5">
                    <li>corrupt the DB if sync hits during a write (especially dangerous with WAL);</li>
                    <li>create version conflicts if TaskFlow runs on two machines at once — SQLite cannot merge across machines;</li>
                    <li>hang startup if the file is “freed” (online-only) — turn off “Files On-Demand” in OneDrive to fix.</li>
                  </ul>
                  <div>If you still want cloud storage: use only one PC at a time, fully quit TaskFlow before sync runs, and regularly export to JSON onto a local drive.</div>
                  <div>A safer cross-PC workflow is <span className="text-text">Export/Import</span> in JSON.</div>
                </div>
              </>
            )}
          </div>

          {/* v0.8.11: блок «Резервная копия» */}
          <div className="mt-2 px-3.5 py-3 rounded-lg border border-border-soft bg-surface-alt/60 text-[12px] leading-relaxed space-y-2">
            <div className="flex items-center gap-2 font-semibold text-text">
              <HardDrive size={13} className="text-muted" />
              {lang === 'ru' ? 'Резервная копия' : 'Backup'}
            </div>
            {lang === 'ru' ? (
              <div className="text-muted space-y-1.5">
                <div>TaskFlow автоматически создаёт бинарную копию БД в той же папке при каждом закрытии приложения. Файл перезаписывается — хранится всегда одна последняя копия.</div>
                <div>Путь к файлу:</div>
                <div className="px-2 py-1.5 bg-surface border border-border-soft rounded font-mono text-[11px] text-text break-all">{backupPath ?? '…'}</div>
                <div>Чтобы восстановиться из копии: закройте TaskFlow, переименуйте <span className="font-mono text-text">.backup</span>-файл в имя основного (заменив выбитый файл), запустите приложение заново. Подробнее — во вкладке Помощь → «Что делать, если всё сломалось».</div>
              </div>
            ) : (
              <div className="text-muted space-y-1.5">
                <div>TaskFlow automatically creates a binary backup in the same folder every time the app closes. The file is overwritten — always exactly one latest copy is kept.</div>
                <div>Backup file:</div>
                <div className="px-2 py-1.5 bg-surface border border-border-soft rounded font-mono text-[11px] text-text break-all">{backupPath ?? '…'}</div>
                <div>To restore: close TaskFlow, rename the <span className="font-mono text-text">.backup</span> file to the main DB name (replacing the broken file), and start the app again. See Help → "What if everything broke" for details.</div>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleBackupNow}
                disabled={backupBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt disabled:opacity-50"
              >
                {backupBusy
                  ? (lang === 'ru' ? 'Сохранение…' : 'Saving…')
                  : (lang === 'ru' ? 'Создать копию сейчас' : 'Create backup now')}
              </button>
              <button
                onClick={handleOpenBackupFolder}
                disabled={!backupPath}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt disabled:opacity-50"
              >
                <FolderOpen size={13} />
                {lang === 'ru' ? 'Открыть папку' : 'Open folder'}
              </button>
            </div>
          </div>

          {/* v0.8.12: блок «Диагностика» — лог-файл и версия схемы БД */}
          <div className="mt-2 px-3.5 py-3 rounded-lg border border-border-soft bg-surface-alt/60 text-[12px] leading-relaxed space-y-2">
            <div className="flex items-center gap-2 font-semibold text-text">
              <Info size={13} className="text-muted" />
              {lang === 'ru' ? 'Диагностика' : 'Diagnostics'}
            </div>
            {lang === 'ru' ? (
              <div className="text-muted space-y-1.5">
                <div>Приложение ведёт технический лог в файл рядом с БД (одна строка = одно событие в JSON). При достижении 1 MB файл ротируется в <span className="font-mono text-text">taskflow.log.old</span>. Никакие данные никуда не отправляются.</div>
                <div>Файл лога:</div>
                <div className="px-2 py-1.5 bg-surface border border-border-soft rounded font-mono text-[11px] text-text break-all">{logPath ?? '…'}</div>
                <div>Версия схемы БД: <span className="font-mono text-text">v{schemaVer ?? '?'}</span> — поднимается автоматически при следующих обновлениях.</div>
              </div>
            ) : (
              <div className="text-muted space-y-1.5">
                <div>The app writes a technical log next to the DB file (one JSON line per event). When the file reaches 1 MB it is rotated to <span className="font-mono text-text">taskflow.log.old</span>. Nothing is uploaded anywhere.</div>
                <div>Log file:</div>
                <div className="px-2 py-1.5 bg-surface border border-border-soft rounded font-mono text-[11px] text-text break-all">{logPath ?? '…'}</div>
                <div>DB schema version: <span className="font-mono text-text">v{schemaVer ?? '?'}</span> — bumped automatically by future updates.</div>
              </div>
            )}
            <div className="flex gap-2 pt-1 flex-wrap">
              <button
                onClick={handleOpenLog}
                disabled={!logPath}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt disabled:opacity-50"
              >
                <FolderOpen size={13} />
                {lang === 'ru' ? 'Открыть лог' : 'Open log'}
              </button>
              <button
                onClick={handleClearLog}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt text-muted"
              >
                <Trash2 size={13} />
                {lang === 'ru' ? 'Очистить лог' : 'Clear log'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Danger Zone ─────────────────────────────── */}
      <div className="mt-8 border border-red-500/40 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--status-important)]">
          <AlertTriangle size={15} />
          {lang === 'ru' ? '⚠ Опасная зона' : '⚠ Danger Zone'}
        </div>
        <p className="text-[12px] text-muted">
          {lang === 'ru'
            ? 'Полное удаление всех задач, тэгов и статусов. Действие необратимо.'
            : 'Permanently deletes all tasks, tags, and statuses. This cannot be undone.'}
        </p>
        <button
          onClick={() => setDangerStep(1)}
          className="px-4 py-2 text-[13px] border border-[var(--status-important)] text-[var(--status-important)] rounded-lg hover:bg-[var(--status-important)] hover:text-white font-medium transition-colors"
        >
          {lang === 'ru' ? 'Стереть все данные' : 'Erase all data'}
        </button>
      </div>

      {/* First confirm */}
      <ConfirmDialog
        open={dangerStep === 1}
        title={lang === 'ru' ? 'Стереть все данные?' : 'Erase all data?'}
        message={lang === 'ru'
          ? 'Вы собираетесь полностью стереть все задачи, тэги и статусы. Это действие необратимо. Продолжить?'
          : 'You are about to permanently erase all tasks, tags, and statuses. This cannot be undone. Continue?'}
        confirmLabel={lang === 'ru' ? 'Продолжить' : 'Continue'}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => setDangerStep(2)}
        onCancel={() => setDangerStep(0)}
      />

      {/* Second confirm */}
      <ConfirmDialog
        open={dangerStep === 2}
        title={lang === 'ru' ? 'Точно уверены?' : 'Are you absolutely sure?'}
        message={lang === 'ru'
          ? 'Точно уверены? Все данные будут потеряны без возможности восстановления.'
          : 'Are you sure? All data will be lost with no way to recover it.'}
        confirmLabel={lang === 'ru' ? 'Да, стереть всё' : 'Yes, erase everything'}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { setDangerStep(0); void handleDangerReset(); }}
        onCancel={() => setDangerStep(0)}
      />

      {/* v0.8.10: Просьба перезапустить после смены пути БД */}
      <ConfirmDialog
        open={restartModal}
        title={lang === 'ru' ? 'Требуется перезапуск' : 'Restart required'}
        message={lang === 'ru'
          ? 'Путь к базе данных изменён. Чтобы приложение начало писать в новый файл, его нужно перезапустить. Существующая база будет скопирована в новое место автоматически (если там ещё нет файла).'
          : 'The database path has been changed. To start writing to the new file, the app must be restarted. The existing database will be copied to the new location automatically (if no file is there yet).'}
        confirmLabel={lang === 'ru' ? 'Перезапустить сейчас' : 'Restart now'}
        cancelLabel={lang === 'ru' ? 'Позже' : 'Later'}
        onConfirm={() => { setRestartModal(false); void handleRestart(); }}
        onCancel={() => setRestartModal(false)}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border-soft">
      <div className="text-[13px] text-muted">{label}</div>
      <div>{children}</div>
    </div>
  );
}

// v0.9.31: TimezoneRow — селектор часового пояса.
// 'auto' — локальный (по getFullYear/Month/Date), любое другое валидное
// IANA-значение — через Intl.DateTimeFormat(tz).
// Кураторский список популярных таймзон, чтобы не вываливать 400+ пунктов.
const TZ_OPTIONS: { value: string; label: string }[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/Moscow', label: 'Europe/Moscow (MSK, UTC+3)' },
  { value: 'Europe/Kaliningrad', label: 'Europe/Kaliningrad (UTC+2)' },
  { value: 'Europe/Samara', label: 'Europe/Samara (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Asia/Yekaterinburg (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Asia/Omsk (UTC+6)' },
  { value: 'Asia/Krasnoyarsk', label: 'Asia/Krasnoyarsk (UTC+7)' },
  { value: 'Asia/Irkutsk', label: 'Asia/Irkutsk (UTC+8)' },
  { value: 'Asia/Yakutsk', label: 'Asia/Yakutsk (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Asia/Vladivostok (UTC+10)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET)' },
  { value: 'Europe/Kyiv', label: 'Europe/Kyiv (EET)' },
  { value: 'Europe/Istanbul', label: 'Europe/Istanbul (UTC+3)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (UTC+4)' },
  { value: 'Asia/Almaty', label: 'Asia/Almaty (UTC+5)' },
  { value: 'Asia/Tashkent', label: 'Asia/Tashkent (UTC+5)' },
  { value: 'Asia/Bangkok', label: 'Asia/Bangkok (UTC+7)' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (UTC+10/11)' },
  { value: 'America/New_York', label: 'America/New_York (ET)' },
  { value: 'America/Chicago', label: 'America/Chicago (CT)' },
  { value: 'America/Denver', label: 'America/Denver (MT)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PT)' },
  { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo (BRT)' },
];

function TimezoneRow({ lang }: { lang: 'ru' | 'en' }) {
  const timezone = useStore(s => s.timezone);
  const setTimezone = useStore(s => s.setTimezone);

  // Авто-определённая системная TZ — для отображения в подсказке к варианту 'auto'.
  let detectedTz = '';
  try {
    detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch { /* ignore */ }

  // Если сохранённое значение не в списке — добавим его в начало (чтобы select корректно отображал).
  const inList = timezone === 'auto' || TZ_OPTIONS.some(o => o.value === timezone);

  return (
    <div className="py-2 border-b border-border-soft">
      <div className="flex items-center justify-between gap-4">
        <div className="text-[13px] text-muted">{tr(lang, 'tz_label')}</div>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px] max-w-[280px]"
        >
          <option value="auto">
            {tr(lang, 'tz_auto')}{detectedTz ? ` — ${detectedTz}` : ''}
          </option>
          {!inList && (
            <option value={timezone}>{timezone}</option>
          )}
          {TZ_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="text-[11px] text-muted mt-1.5 leading-relaxed max-w-[560px]">
        {tr(lang, 'tz_hint')}
      </div>
    </div>
  );
}

/**
 * v0.8.13: TemplatesSection — управление пользовательскими шаблонами задач.
 *
 * Что умеет:
 * - Показывает все сохранённые шаблоны (включая сид «Шаблон задачи 1» из миграции v2).
 * - Раскрытие карточки шаблона — редактируемые поля «Имя», «Заголовок задачи», «Комментарий».
 * - Кнопка удаления (с инлайн-подтверждением, без модалки — раздел и так перегружен).
 * - Если шаблонов нет — мини-пояснение, как их создавать (TaskModal → «Сохранить как шаблон»).
 *
 * Не используем drag-and-drop сортировку: это редко, и порядок шаблонов в меню
 * определяется sort_order из БД + id (стабильно, предсказуемо).
 */
function TemplatesSection({ lang }: { lang: 'ru' | 'en' }) {
  const templates = useStore(s => s.taskTemplates);
  const updateTemplate = useStore(s => s.updateTemplate);
  const deleteTemplate = useStore(s => s.deleteTemplate);
  const pushToast = useStore(s => s.pushToast);

  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  return (
    <div className="mt-8 space-y-3">
      <h3 className="font-display text-[16px] font-semibold flex items-center gap-2">
        <FileText size={16} />
        {lang === 'ru' ? 'Шаблоны задач' : 'Task templates'}
      </h3>
      <p className="text-[12px] text-muted">
        {lang === 'ru'
          ? 'Создавайте шаблоны из любой задачи (в окне редактирования — «Сохранить как шаблон»). Затем используйте их через стрелку «▾» рядом с кнопкой «+ Новая задача» на странице «Задачи».'
          : 'Save any task as a template (use “Save as template” in the task editor). Then use them via the “▾” arrow next to “+ New task” on the Tasks page.'}
      </p>

      {templates.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-muted border border-dashed border-border-soft rounded-lg">
          {lang === 'ru' ? 'Пока нет шаблонов.' : 'No templates yet.'}
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map(tpl => {
            const isOpen = expanded === tpl.id;
            return (
              <div
                key={tpl.id}
                className="border border-border-soft rounded-lg bg-surface-alt/40"
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <FileText size={13} className="text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{tpl.name}</div>
                    {tpl.title && (
                      <div className="text-[11px] text-muted truncate">{tpl.title}</div>
                    )}
                  </div>
                  <button
                    onClick={() => setExpanded(isOpen ? null : tpl.id)}
                    className="flex items-center gap-1 px-2 py-1 text-[12px] border border-border-soft rounded hover:bg-surface-alt"
                    title={lang === 'ru' ? 'Изменить' : 'Edit'}
                  >
                    <Pencil size={12} />
                    {lang === 'ru' ? 'Изменить' : 'Edit'}
                  </button>
                  {confirmDelete === tpl.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          deleteTemplate(tpl.id);
                          setConfirmDelete(null);
                          if (expanded === tpl.id) setExpanded(null);
                          pushToast(lang === 'ru' ? 'Шаблон удалён' : 'Template deleted');
                        }}
                        className="px-2 py-1 text-[12px] bg-[var(--status-important)] text-white rounded"
                      >
                        {lang === 'ru' ? 'Удалить' : 'Delete'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-2 py-1 text-[12px] border border-border-soft rounded hover:bg-surface-alt"
                      >
                        {tr(lang, 'cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(tpl.id)}
                      className="w-7 h-7 flex items-center justify-center rounded hover:bg-[color-mix(in_srgb,var(--status-important)_15%,transparent)] text-[var(--status-important)]"
                      title={tr(lang, 'delete')}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border-soft">
                    <label className="block">
                      <span className="text-[11px] text-muted uppercase tracking-wider">
                        {lang === 'ru' ? 'Имя шаблона' : 'Template name'}
                      </span>
                      <input
                        type="text"
                        value={tpl.name}
                        onChange={(e) => updateTemplate(tpl.id, { name: e.target.value })}
                        className="mt-1 w-full bg-surface border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-muted uppercase tracking-wider">
                        {lang === 'ru' ? 'Заголовок задачи' : 'Task title'}
                      </span>
                      <input
                        type="text"
                        value={tpl.title}
                        onChange={(e) => updateTemplate(tpl.id, { title: e.target.value })}
                        className="mt-1 w-full bg-surface border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-muted uppercase tracking-wider">
                        {lang === 'ru' ? 'Комментарий (поддерживает markdown-чекбоксы)' : 'Comment (supports markdown checkboxes)'}
                      </span>
                      <textarea
                        value={tpl.comment}
                        onChange={(e) => updateTemplate(tpl.id, { comment: e.target.value })}
                        rows={Math.min(12, Math.max(4, (tpl.comment.match(/\n/g)?.length ?? 0) + 2))}
                        className="mt-1 w-full bg-surface border border-border-soft rounded px-2.5 py-1.5 text-[12px] font-mono leading-relaxed resize-y"
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// v0.9.8: секция «Обновления» — Tauri auto-updater
// v0.9.33: на macOS авто-апдейт недоступен (сборка не подписана Apple сертификатом),
// вместо кнопки «Скачать и установить» показываем линк на GitHub Releases.
function UpdatesSection() {
  const lang = useStore(s => s.language);
  const autoUpdate = useStore(s => s.autoUpdateEnabled);
  const setAutoUpdate = useStore(s => s.setAutoUpdateEnabled);
  const currentVersion = pkg.version;

  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [osName, setOsName] = useState<string>('');

  const tauri = isTauri();
  const isMacOs = osName === 'macos';

  useEffect(() => {
    if (!tauri) return;
    (async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os');
        setOsName(await platform());
      } catch {
        // не критично — остаётся windows-поведение по умолчанию
      }
    })();
  }, [tauri]);

  const check = async () => {
    setChecking(true);
    setError(null);
    setInfo(null);
    try {
      const res = await checkForUpdate(currentVersion);
      setInfo(res);
      setLastChecked(new Date());
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    setInstalling(true);
    setError(null);
    setProgress(0);
    try {
      await downloadAndInstall(setProgress);
    } catch (e: any) {
      setError(String(e?.message || e));
      setInstalling(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <h3 className="font-display text-[16px] font-semibold">
        {lang === 'ru' ? 'Обновления' : 'Updates'}
      </h3>

      <Row label={lang === 'ru' ? 'Текущая версия' : 'Current version'}>
        <span className="mono text-[13px]">v{currentVersion}</span>
      </Row>

      <Row label={lang === 'ru' ? 'Проверять автоматически' : 'Check automatically'}>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setAutoUpdate(!autoUpdate)}
            className={
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' +
              (autoUpdate ? 'bg-accent' : 'bg-surface-alt border border-border-soft')
            }
            aria-pressed={autoUpdate}
          >
            <span
              className={
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform ' +
                (autoUpdate ? 'translate-x-6' : 'translate-x-1')
              }
            />
          </button>
          <div className="text-[11px] text-muted">
            {lang === 'ru'
              ? 'При включении TaskFlow будет проверять новые версии при запуске приложения. Установка — только по вашему подтверждению.'
              : 'When enabled, TaskFlow checks for new versions at startup. Installation requires your confirmation.'}
          </div>
        </div>
      </Row>

      <Row label={lang === 'ru' ? 'Проверить сейчас' : 'Check now'}>
        <div className="flex flex-col gap-2 w-full">
          <button
            type="button"
            onClick={check}
            disabled={checking || installing || !tauri}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-[13px] rounded-md border border-border-soft hover:bg-surface-alt disabled:opacity-50 disabled:cursor-not-allowed w-fit"
          >
            <RefreshCw className={'w-4 h-4 ' + (checking ? 'animate-spin' : '')} />
            {checking
              ? (lang === 'ru' ? 'Проверяю…' : 'Checking…')
              : (lang === 'ru' ? 'Проверить обновления' : 'Check for updates')}
          </button>
          {!tauri && (
            <div className="text-[11px] text-muted">
              {lang === 'ru'
                ? 'Проверка доступна только в собранном приложении (не в dev-режиме браузера).'
                : 'Available only in the built app (not in browser dev mode).'}
            </div>
          )}
          {lastChecked && !checking && (
            <div className="text-[11px] text-muted">
              {lang === 'ru' ? 'Последняя проверка: ' : 'Last checked: '}
              {lastChecked.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}
            </div>
          )}
        </div>
      </Row>

      {info && info.available && !installing && (
        <div className="rounded-lg border border-accent bg-accent-soft p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            <span className="font-semibold text-[14px]">
              {lang === 'ru'
                ? `Доступна новая версия v${info.newVersion}`
                : `New version v${info.newVersion} available`}
            </span>
          </div>
          {info.notes && (
            <div className="text-[12px] text-muted whitespace-pre-wrap max-h-32 overflow-y-auto">
              {info.notes}
            </div>
          )}
          {isMacOs ? (
            <>
              <div className="text-[12px] text-muted">
                {lang === 'ru'
                  ? 'Сборка под macOS не подписана, поэтому авто-установка обновлений недоступна. Скачайте новый .dmg вручную с GitHub Releases и установите поверх текущей версии.'
                  : 'The macOS build is unsigned, so auto-install is unavailable. Please download the new .dmg from GitHub Releases and install it over the current version.'}
              </div>
              <a
                href={`https://github.com/danny-swan/taskflow-app/releases/tag/v${info.newVersion}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 text-[13px] rounded-md bg-accent text-white hover:opacity-90 w-fit"
              >
                <Download className="w-4 h-4" />
                {lang === 'ru' ? 'Открыть страницу релиза на GitHub' : 'Open release page on GitHub'}
              </a>
            </>
          ) : (
            <button
              type="button"
              onClick={install}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-[13px] rounded-md bg-accent text-white hover:opacity-90"
            >
              <Download className="w-4 h-4" />
              {lang === 'ru' ? 'Скачать и установить' : 'Download and install'}
            </button>
          )}
        </div>
      )}

      {info && !info.available && !checking && (
        <div className="rounded-lg border border-border-soft p-3 text-[13px] flex items-center gap-2">
          <Check className="w-4 h-4 text-accent" />
          {lang === 'ru' ? 'У вас последняя версия.' : 'You are on the latest version.'}
        </div>
      )}

      {installing && (
        <div className="rounded-lg border border-accent bg-accent-soft p-4 space-y-2">
          <div className="text-[13px] font-semibold">
            {lang === 'ru' ? 'Устанавливаю обновление…' : 'Installing update…'}
          </div>
          <div className="w-full h-2 rounded-full bg-surface-alt overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-[11px] text-muted mono">{progress}%</div>
          <div className="text-[11px] text-muted">
            {lang === 'ru'
              ? 'После установки приложение перезапустится автоматически.'
              : 'The app will restart automatically after installation.'}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-400 bg-red-50 dark:bg-red-900/10 p-3 text-[12px] text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// v0.9.9: AccountSection — email, дата регистрации, выход, удаление аккаунта
// ============================================================================
function AccountSection() {
  const lang = useStore(s => s.language);
  const isRu = lang === 'ru';
  const auth = useAuth();
  const pushToast = useStore(s => s.pushToast);

  const [showPrivacy, setShowPrivacy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // v0.9.14: modal-флаги для смены пароля/email.
  const [showChangePassword, setShowChangePassword] = useState(false);
  const { prompt, PromptUI } = usePrompt();

  const t = (ru: string, en: string) => (isRu ? ru : en);

  const user = auth.session?.user;
  // v0.9.14: проверяем провайдер. Для Google-аккаунтов пароль/email меняются через Google, не через Supabase.
  const isEmailProvider = (() => {
    const identities = (user as any)?.identities as Array<{ provider: string }> | undefined;
    if (identities && identities.length > 0) {
      return identities.some(i => i.provider === 'email');
    }
    // fallback: если identities нет, смотрим app_metadata.provider.
    return (user?.app_metadata as any)?.provider !== 'google';
  })();
  const createdAt = user?.created_at ? new Date(user.created_at).toLocaleDateString(isRu ? 'ru-RU' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  const lastSignIn = user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString(isRu ? 'ru-RU' : 'en-US') : '—';

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await logEvent('logout');
      await signOut();
      pushToast(t('Вы вышли из аккаунта', 'You have been signed out'));
    } catch (e: any) {
      pushToast(e?.message ?? t('Ошибка выхода', 'Sign out error'));
    } finally {
      setBusy(false);
    }
  };

  // v0.9.14: смена email — Supabase пошлёт письмо-подтверждение на новый адрес.
  const handleChangeEmail = async () => {
    const newEmail = await prompt({
      title: t('Смена email', 'Change email'),
      placeholder: 'new@example.com',
      defaultValue: '',
      confirmLabel: t('Отправить', 'Send'),
      cancelLabel: t('Отмена', 'Cancel'),
      validate: v => {
        if (!v || !v.includes('@') || !v.includes('.')) {
          return t('Введите корректный email', 'Please enter a valid email');
        }
        if (v.toLowerCase() === user?.email?.toLowerCase()) {
          return t('Это ваш текущий email', 'This is your current email');
        }
        return null;
      },
    });
    if (!newEmail) return;
    setBusy(true);
    try {
      await updateEmail(newEmail);
      pushToast(t(
        'На новый адрес отправлено письмо — перейдите по ссылке, чтобы подтвердить смену',
        'A confirmation link has been sent to the new address',
      ));
    } catch (e: any) {
      pushToast(e?.message ?? t('Ошибка смены email', 'Email change error'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteAccount();
      pushToast(t('Аккаунт помечен на удаление', 'Account marked for deletion'));
    } catch (e: any) {
      pushToast(e?.message ?? t('Ошибка удаления', 'Deletion error'));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-xl">
        <h3 className="font-display text-[16px] font-semibold mb-4">
          {t('Аккаунт', 'Account')}
        </h3>
        <p className="text-[13px] text-muted">
          {t('Вы не авторизованы.', 'You are not signed in.')}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <h3 className="font-display text-[16px] font-semibold flex items-center gap-2">
        <User size={16} />
        {t('Аккаунт', 'Account')}
      </h3>

      <div className="bg-surface-alt border border-border-soft rounded-lg p-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-muted uppercase tracking-wide">Email</span>
          <span className="text-[13px] font-medium">{user.email}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-muted uppercase tracking-wide">
            {t('Зарегистрирован', 'Registered')}
          </span>
          <span className="text-[13px]">{createdAt}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-muted uppercase tracking-wide">
            {t('Последний вход', 'Last sign in')}
          </span>
          <span className="text-[13px]">{lastSignIn}</span>
        </div>
        {auth.gracePeriod && (
          <div className="pt-2 border-t border-border-soft text-[12px] text-muted">
            {t(
              'Работает в оффлайн-режиме. Для продления сессии подключитесь к интернету раз в неделю.',
              'Working offline. Reconnect to the internet weekly to extend your session.',
            )}
          </div>
        )}
      </div>

      {/* v0.9.14: смена пароля и email — только для email-провайдера. Google-юзеры меняют в своём аккаунте Google. */}
      {isEmailProvider && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowChangePassword(true)}
            disabled={busy}
            className="w-full sm:w-auto flex items-center justify-start gap-2 px-4 py-2 text-[13px] border border-border-soft rounded-md hover:bg-surface-alt disabled:opacity-50"
          >
            <KeyRound size={14} />
            {t('Сменить пароль', 'Change password')}
          </button>
          <button
            onClick={handleChangeEmail}
            disabled={busy}
            className="w-full sm:w-auto flex items-center justify-start gap-2 px-4 py-2 text-[13px] border border-border-soft rounded-md hover:bg-surface-alt disabled:opacity-50"
          >
            <Mail size={14} />
            {t('Сменить email', 'Change email')}
          </button>
        </div>
      )}

      <div>
        <button
          onClick={() => setShowPrivacy(true)}
          className="flex items-center gap-2 text-[13px] text-accent hover:underline"
        >
          <Shield size={14} />
          {t('Политика конфиденциальности', 'Privacy Policy')}
        </button>
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-border-soft">
        <button
          onClick={handleSignOut}
          disabled={busy}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 text-[13px] border border-border-soft rounded-md hover:bg-surface-alt disabled:opacity-50"
        >
          <LogOut size={14} />
          {t('Выйти из аккаунта', 'Sign out')}
        </button>

        <button
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 text-[13px] text-red-600 border border-red-500/30 rounded-md hover:bg-red-500/10 disabled:opacity-50"
        >
          <Trash2 size={14} />
          {t('Удалить аккаунт', 'Delete account')}
        </button>
      </div>

      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
      {showChangePassword && (
        <PasswordResetModal
          mode="change"
          userEmail={user?.email}
          onClose={() => setShowChangePassword(false)}
        />
      )}
      <PromptUI />

      <ConfirmDialog
        open={confirmDelete}
        title={t('Удалить аккаунт?', 'Delete account?')}
        message={t(
          'Аккаунт и вся телеметрия будут удалены безвозвратно. Локальные задачи останутся на устройстве.',
          'Your account and all telemetry will be permanently deleted. Local tasks stay on your device.',
        )}
        confirmLabel={t('Удалить', 'Delete')}
        cancelLabel={t('Отмена', 'Cancel')}
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

// ─── SyncSection (v0.9.35-dev.4) ────────────────────────────────────────────
/**
 * Раздел настроек «Синхронизация».
 *   - Показывает текущий статус (idle/pulling/pushing/synced/error/skipped).
 *   - Показывает last synced at (человекочитаемо).
 *   - Кнопка «Синхронизировать сейчас» — вызывает syncNow() вручную. В dev-сборке
 *     это единственный триггер (авто-sync отключён). В prod — вспомогательный.
 *   - Ссылка на sync_devices (для отладки, показывает client_id).
 *
 * Реализация: lazy import модуля sync/index через useEffect. Это позволяет
 * держать чанк sync/* вне initial bundle Settings-страницы.
 */
function SyncSection() {
  const lang = useStore(s => s.language);
  const auth = useAuth();
  const t = (ru: string, en: string) => (lang === 'ru' ? ru : en);
  const isDev = import.meta.env.DEV;

  const [status, setStatus] = useState<string>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncModuleRef = useRef<any>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let mounted = true;
    void import('../lib/sync').then(m => {
      if (!mounted) return;
      syncModuleRef.current = m;
      const initial = m.getSyncState();
      setStatus(initial.status);
      setLastSyncedAt(initial.lastSyncedAt);
      setLastError(initial.lastError);
      unsubscribe = m.subscribeSyncState(s => {
        setStatus(s.status);
        setLastSyncedAt(s.lastSyncedAt);
        setLastError(s.lastError);
      });
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[sync/settings] module load failed:', err);
    });
    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const runNow = async () => {
    if (!syncModuleRef.current || syncing) return;
    setSyncing(true);
    try {
      await syncModuleRef.current.syncNow();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[sync/settings] syncNow failed:', e);
    } finally {
      setSyncing(false);
    }
  };

  const clientId = (typeof window !== 'undefined')
    ? (() => {
        try {
          // Не тащим импорт сюда — читаем напрямую через localStorage если хотим,
          // но проще через lazy-модуль. Пока показываем '—', детали в UI не нужны.
          return null;
        } catch { return null; }
      })()
    : null;

  const statusLabel = (() => {
    if (status === 'idle') return t('Ожидание', 'Idle');
    if (status === 'pulling') return t('Скачивание изменений…', 'Pulling changes…');
    if (status === 'pushing') return t('Отправка изменений…', 'Pushing changes…');
    if (status === 'synced') return t('Синхронизировано', 'Synced');
    if (status === 'error') return t('Ошибка', 'Error');
    if (status === 'skipped') return t('Не выполнена (нет сессии)', 'Skipped (no session)');
    return status;
  })();

  const statusColor = (() => {
    if (status === 'error') return 'text-[var(--error,#c33)]';
    if (status === 'synced') return 'text-[var(--success,#7a3)]';
    if (status === 'pulling' || status === 'pushing') return 'text-accent';
    return 'text-muted';
  })();

  const formatLastSynced = (): string => {
    if (!lastSyncedAt) return t('никогда', 'never');
    try {
      const d = new Date(lastSyncedAt);
      const diffMs = Date.now() - d.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 5) return t('только что', 'just now');
      if (diffSec < 60) return t(`${diffSec} сек назад`, `${diffSec}s ago`);
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return t(`${diffMin} мин назад`, `${diffMin}m ago`);
      const diffH = Math.floor(diffMin / 60);
      if (diffH < 24) return t(`${diffH} ч назад`, `${diffH}h ago`);
      return d.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US');
    } catch { return lastSyncedAt; }
  };

  const _clientIdUnused = clientId; // подавляем warning про unused (пока не показываем)
  void _clientIdUnused;

  return (
    <div className="max-w-2xl">
      <h2 className="text-[15px] font-semibold mb-1">
        {t('Синхронизация с облаком', 'Cloud sync')}
      </h2>
      <p className="text-[12px] text-muted mb-4">
        {t(
          'Ваши задачи автоматически синхронизируются между устройствами, если вы вошли в аккаунт. Полностью локальная работа тоже поддерживается — вы всегда владеете своими данными.',
          'Your tasks sync automatically across devices when you\'re signed in. Local-only workflow is also supported — you always own your data.',
        )}
      </p>

      {!auth.session?.user && (
        <div className="mb-4 px-3 py-2 rounded-md border border-border-soft bg-[var(--surface-alt)]/40 text-[12px] text-muted">
          {t(
            'Вы не вошли в аккаунт. Синхронизация недоступна — все задачи остаются локальными.',
            'You\'re not signed in. Sync is unavailable — all tasks stay local.',
          )}
        </div>
      )}

      {/* Статус */}
      <div className="mb-3 px-3 py-2.5 rounded-md border border-border-soft bg-surface">
        <div className="flex items-center gap-2 mb-1">
          <Cloud size={14} className={statusColor} />
          <span className="text-[13px] font-medium">
            {t('Статус:', 'Status:')} <span className={statusColor}>{statusLabel}</span>
          </span>
        </div>
        <div className="text-[11px] text-muted">
          {t('Последняя синхронизация:', 'Last synced:')} {formatLastSynced()}
        </div>
        {lastError && (
          <div className="text-[11px] text-[var(--error,#c33)] mt-1 truncate" title={lastError}>
            {t('Ошибка:', 'Error:')} {lastError}
          </div>
        )}
      </div>

      {/* Кнопка запуска */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={runNow}
          disabled={syncing || !auth.session?.user || status === 'pulling' || status === 'pushing'}
          className="px-3.5 py-1.5 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {syncing ? t('Синхронизация…', 'Syncing…') : t('Синхронизировать сейчас', 'Sync now')}
        </button>
        {isDev && (
          <span className="text-[11px] text-muted">
            {t('Dev-сборка: авто-sync отключён.', 'Dev build: auto-sync disabled.')}
          </span>
        )}
      </div>

      {/* Инфо о feature flag */}
      <details className="text-[11px] text-muted">
        <summary className="cursor-pointer hover:text-text">
          {t('Как работает синхронизация?', 'How does sync work?')}
        </summary>
        <div className="mt-2 pl-2 space-y-1.5">
          <p>
            {t(
              '• Конфликт-резолюшн: last-write-wins по updated_at (server-side).',
              '• Conflict resolution: last-write-wins by updated_at (server-side).',
            )}
          </p>
          <p>
            {t(
              '• Удаление: soft-delete (deleted_at), запись остаётся в облаке для истории.',
              '• Deletion: soft-delete (deleted_at), row stays in cloud for history.',
            )}
          </p>
          <p>
            {t(
              '• Retry: экспоненциальный backoff (1→2→4→8→16 сек), максимум 5 попыток.',
              '• Retry: exponential backoff (1→2→4→8→16s), max 5 attempts.',
            )}
          </p>
          <p>
            {isDev
              ? t(
                  '• В prod-сборке синхронизация запускается автоматически: при старте, возврате фокуса и через 2с после любого изменения.',
                  '• In prod builds sync runs automatically: on startup, focus return, and 2s after any change.',
                )
              : t(
                  '• Автоматическая синхронизация: при старте, возврате фокуса и через 2с после любого изменения.',
                  '• Automatic sync: on startup, focus return, and 2s after any change.',
                )}
          </p>
        </div>
      </details>
    </div>
  );
}

// ============================================================================
// v0.9.35-dev.6: SubscriptionSection — статус плана, trial, ручная активация,
// альтернативные способы оплаты, история заявок.
// ============================================================================

/**
 * Env-based конфиг альтернативных способов оплаты.
 * Задаётся в `.env.local` (локально) или в CI (без secrets — blocks просто не показываются).
 *
 * VITE_PAY_CLOUDTIPS_URL / VITE_PAY_TON / VITE_PAY_USDT_TRC20 / VITE_PAY_USDT_ERC20
 * VITE_PAY_PRICE_MONTHLY / VITE_PAY_PRICE_ANNUAL / VITE_PAY_PRICE_LIFETIME
 */
type PaymentMethodKey = 'cloudtips' | 'ton' | 'usdt-trc20' | 'usdt-erc20';
type PaymentMethodDef = {
  key: PaymentMethodKey;
  label: string;
  value: string;
  displayValue: string;
  linkUrl?: string;
};

const _env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const PAYMENT_METHODS: PaymentMethodDef[] = (() => {
  const list: PaymentMethodDef[] = [];
  const ct = _env.VITE_PAY_CLOUDTIPS_URL?.trim();
  if (ct) {
    const display = ct.replace(/^https?:\/\//, '');
    list.push({ key: 'cloudtips', label: 'CloudTips (RUB)', value: ct, displayValue: display, linkUrl: ct });
  }
  const ton = _env.VITE_PAY_TON?.trim();
  if (ton) list.push({ key: 'ton', label: 'TON', value: ton, displayValue: ton });
  const trc = _env.VITE_PAY_USDT_TRC20?.trim();
  if (trc) list.push({ key: 'usdt-trc20', label: 'USDT (TRC-20)', value: trc, displayValue: trc });
  const erc = _env.VITE_PAY_USDT_ERC20?.trim();
  if (erc) list.push({ key: 'usdt-erc20', label: 'USDT (ERC-20)', value: erc, displayValue: erc });
  return list;
})();

// v0.9.35-dev.6.4.1: дефолтные цены вшиты (совпадают с i18n subscription_block_price_*).
// Если CI подаёт VITE_PAY_PRICE_* — они переопределяют. Иначе UI всегда
// показывает актуальную цену, без заглушки «цена скоро».
const PRICE_MONTHLY = _env.VITE_PAY_PRICE_MONTHLY?.trim() || '299 ₽';
const PRICE_ANNUAL = _env.VITE_PAY_PRICE_ANNUAL?.trim() || '2 990 ₽';
const PRICE_LIFETIME = _env.VITE_PAY_PRICE_LIFETIME?.trim() || '4 990 ₽';

/** Короткая строка цен, если хотя бы одна цена задана. */
const PRICE_LINE = [PRICE_MONTHLY, PRICE_ANNUAL, PRICE_LIFETIME].filter(Boolean).join(' / ');

function SubscriptionSection() {
  const lang = useStore(s => s.language);
  const isRu = lang === 'ru';
  const pushToast = useStore(s => s.pushToast);
  const auth = useAuth();
  const navigate = useNavigate();
  const t = (ru: string, en: string) => (isRu ? ru : en);

  const user = auth.session?.user;
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;

  // Используем hook: он даёт realtime-обновляемый entitlement.
  const { entitlement, loading: entLoading } = useEntitlement(userId, userEmail);
  // Пока auth или entitlement грузятся — не показываем free-блоки (иначе мелькают для Pro)
  const subsLoading = auth.loading || entLoading;

  // Локальный state для формы ручной активации.
  const [txRef, setTxRef] = useState('');
  const [planRequested, setPlanRequested] = useState<'monthly' | 'annual' | 'lifetime'>('monthly');
  const [providerHint, setProviderHint] = useState<'cloudtips' | 'ton' | 'usdt-trc20' | 'usdt-erc20' | 'other'>(
    (PAYMENT_METHODS[0]?.key ?? 'other') as 'cloudtips' | 'ton' | 'usdt-trc20' | 'usdt-erc20' | 'other',
  );
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // v0.9.35-dev.6.5.1 — recurring management
  const [cancelBusy, setCancelBusy] = useState(false);
  const [reactivateBusy, setReactivateBusy] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  // v0.9.35-dev.6.5.2 — отвязка карты (требование ЮKassa)
  const [detachBusy, setDetachBusy] = useState(false);
  const [detachConfirmOpen, setDetachConfirmOpen] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [pmLoading, setPmLoading] = useState(false);
  // v0.9.35-dev.6.6 — upgrade monthly → annual
  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [upgradeConfirmOpen, setUpgradeConfirmOpen] = useState(false);

  // История заявок пользователя.
  const [requests, setRequests] = useState<ActivationRequestRow[]>([]);
  const [reqLoading, setReqLoading] = useState(false);

  // Загружаем заявки при монтировании и после submit.
  const reloadRequests = async () => {
    if (!userId) {
      setRequests([]);
      return;
    }
    setReqLoading(true);
    try {
      const { data, error } = await supabase
        .from('activation_requests')
        .select('id, created_at, plan_requested, provider_hint, tx_ref, status, admin_notes')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setRequests((data ?? []) as ActivationRequestRow[]);
    } catch (e: any) {
      logger.warn('[SubscriptionSection] loadRequests failed:', e?.message ?? e);
    } finally {
      setReqLoading(false);
    }
  };

  useEffect(() => {
    void reloadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // v0.9.35-dev.6.5.1: загружаем payment_methods только для Pro
  useEffect(() => {
    if (!userId) { setPaymentMethods([]); return; }
    if (entitlement.effectivePlan !== 'pro') { setPaymentMethods([]); return; }
    setPmLoading(true);
    fetchActivePaymentMethods(userId)
      .then(pms => setPaymentMethods(pms))
      .catch(e => logger.warn('[SubscriptionSection] fetchPMs failed:', e?.message ?? e))
      .finally(() => setPmLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, entitlement.effectivePlan, entitlement.paymentMethodId]);

  const handleCancelSubscription = async () => {
    setCancelBusy(true);
    try {
      const res = await cancelSubscription();
      if (res.ok) {
        pushToast(t('Автопродление отменено', 'Auto-renewal cancelled'));
      } else {
        pushToast(t('Не удалось отменить: ', 'Failed to cancel: ') + res.error);
      }
    } catch (e: any) {
      pushToast(e?.message ?? t('Ошибка отмены', 'Cancel error'));
    } finally {
      setCancelBusy(false);
      setCancelConfirmOpen(false);
    }
  };

  const handleReactivateSubscription = async () => {
    setReactivateBusy(true);
    try {
      const res = await reactivateSubscription();
      if (res.ok) {
        pushToast(t('Автопродление включено', 'Auto-renewal enabled'));
      } else {
        pushToast(t('Не удалось включить: ', 'Failed to enable: ') + res.error);
      }
    } catch (e: any) {
      pushToast(e?.message ?? t('Ошибка реактивации', 'Reactivate error'));
    } finally {
      setReactivateBusy(false);
    }
  };

  // v0.9.35-dev.6.5.2 — отвязка карты (требование ЮKassa для автоплатежей)
  const handleDetachPaymentMethod = async () => {
    setDetachBusy(true);
    try {
      const res = await detachPaymentMethod();
      if (res.ok) {
        pushToast(t('Карта отвязана', 'Card detached'));
        // Обновляем список карт локально (realtime догонит, но отобразим сразу).
        setPaymentMethods([]);
      } else {
        pushToast(t('Не удалось отвязать: ', 'Failed to detach: ') + res.error);
      }
    } catch (e: any) {
      pushToast(e?.message ?? t('Ошибка отвязки', 'Detach error'));
    } finally {
      setDetachBusy(false);
      setDetachConfirmOpen(false);
    }
  };

  // v0.9.35-dev.6.6 — upgrade monthly → annual
  const handleUpgradePlan = async () => {
    setUpgradeBusy(true);
    try {
      const res = await changePlan();
      if (res.ok) {
        if (res.confirmation_url) {
          // Требуется 3DS — открываем в системном браузере
          // (Tauri shell open есть в Checkout, тут просто window.open как fallback)
          try {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(res.confirmation_url);
          } catch {
            window.open(res.confirmation_url, '_blank');
          }
          pushToast(t('Открыта страница оплаты. После оплаты подписка автоматически продлится.', 'Payment page opened. Subscription will be extended automatically after payment.'));
        } else {
          const until = new Date(res.new_valid_until).toLocaleDateString(
            isRu ? 'ru-RU' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }
          );
          pushToast(t(`Годовой план активирован до ${until}`, `Annual plan activated until ${until}`));
        }
      } else {
        pushToast(t('Ошибка апгрейда: ', 'Upgrade error: ') + (res.error ?? '?'));
      }
    } catch (e: any) {
      pushToast(e?.message ?? t('Ошибка', 'Error'));
    } finally {
      setUpgradeBusy(false);
      setUpgradeConfirmOpen(false);
    }
  };

  // Guard: если не залогинен — показываем плейсхолдер.
  if (!user) {
    return (
      <div className="max-w-xl space-y-4">
        <h3 className="font-display text-[16px] font-semibold flex items-center gap-2">
          <CircleDollarSign size={16} />
          {t('Подписка', 'Subscription')}
        </h3>
        <p className="text-[13px] text-muted">
          {t('Войдите в аккаунт, чтобы управлять подпиской.', 'Sign in to manage your subscription.')}
        </p>
      </div>
    );
  }

  // Бейдж + русская метка плана.
  const planLabel = (() => {
    if (entitlement.isAdmin) return t('Lifetime (админ)', 'Lifetime (admin)');
    switch (entitlement.effectivePlan) {
      case 'lifetime': return 'Lifetime';
      case 'pro': return 'Pro';
      case 'trial': return t('Trial (14 дней)', 'Trial (14 days)');
      case 'free': return 'Free';
    }
  })();

  const planBadgeColor = (() => {
    switch (entitlement.effectivePlan) {
      case 'lifetime': return 'var(--accent, #01696F)';
      case 'pro': return 'var(--accent, #01696F)';
      case 'trial': return '#DA7101'; // orange
      case 'free': return 'var(--text-muted, #7A7974)';
    }
  })();

  const validUntilStr = (() => {
    if (!entitlement.validUntil) return null;
    return entitlement.validUntil.toLocaleDateString(isRu ? 'ru-RU' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  })();

  const daysLeft = (() => {
    if (entitlement.msLeft == null) return null;
    return Math.max(0, Math.ceil(entitlement.msLeft / 86_400_000));
  })();

  // Показывать кнопку «Начать trial» только если free и trial ни разу не был.
  const canStartTrial = entitlement.effectivePlan === 'free' && !entitlement.trialUsed;


  const handleSubmitActivation = async () => {
    if (!txRef.trim()) {
      pushToast(t('Укажите ID транзакции / хэш перевода', 'Please provide transaction ID / transfer hash'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitActivationRequest({
        txRef: txRef.trim(),
        planRequested,
        providerHint,
        notes: notes.trim() || undefined,
      });
      if (res.ok) {
        pushToast(t('Заявка отправлена. Мы проверим в течение 24 часов.', 'Request submitted. We will review within 24 hours.'));
        setTxRef('');
        setNotes('');
        void reloadRequests();
      } else {
        pushToast(t('Ошибка: ', 'Error: ') + (res.error ?? '?'));
      }
    } catch (e: any) {
      pushToast(e?.message ?? t('Ошибка отправки', 'Submit error'));
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast(t(`${label} скопирован`, `${label} copied`));
    } catch {
      pushToast(t('Не удалось скопировать', 'Copy failed'));
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <h3 className="font-display text-[16px] font-semibold flex items-center gap-2">
        <CircleDollarSign size={16} />
        {t('Подписка', 'Subscription')}
      </h3>

      {/* ──── Текущий план ──── */}
      <div className="bg-surface-alt border border-border-soft rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-muted uppercase tracking-wide">
            {t('Текущий план', 'Current plan')}
          </span>
          {subsLoading ? (
            <span className="h-5 w-16 rounded bg-border animate-pulse inline-block" />
          ) : (
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded"
              style={{ background: planBadgeColor, color: '#fff' }}
            >
              {planLabel}
            </span>
          )}
        </div>
        {validUntilStr && (
          <div className="flex justify-between items-center">
            <span className="text-[12px] text-muted uppercase tracking-wide">
              {entitlement.effectivePlan === 'trial'
                ? t('Trial до', 'Trial until')
                : t('Действует до', 'Valid until')}
            </span>
            <span className="text-[13px] font-medium tabular-nums">
              {validUntilStr}
              {daysLeft != null && (
                <span className="text-muted ml-1.5">
                  ({t(`${daysLeft} дн.`, `${daysLeft} d`)})
                </span>
              )}
            </span>
          </div>
        )}
        {entitlement.effectivePlan === 'lifetime' && (
          <p className="text-[12px] text-muted">
            {entitlement.isAdmin
              ? t('Grandfathered админ-доступ.', 'Grandfathered admin access.')
              : t('Оплачено единоразово, продлевать не нужно.', 'One-time payment, no renewal needed.')}
          </p>
        )}
        {entitlement.effectivePlan === 'free' && entitlement.trialUsed && (
          <p className="text-[12px] text-muted">
            {t('Trial уже был использован. Оформите подписку для облачных функций.', 'Trial already used. Purchase a subscription for cloud features.')}
          </p>
        )}
      </div>

      {/* ──── v0.9.35-dev.6.5.1: Управление подпиской (только Pro) ──── */}
      {entitlement.effectivePlan === 'pro' && (
        <div className="bg-surface-alt border border-border-soft rounded-lg p-4 space-y-4">
          <h4 className="text-[14px] font-semibold flex items-center gap-2">
            <RefreshCw size={14} />
            {t('Управление подпиской', 'Subscription management')}
          </h4>

          {/* Предупреждение о неудачных попытках списания */}
          {entitlement.renewalAttempts > 0 && (
            <div
              className="rounded-md p-3 border text-[12px] flex items-start gap-2"
              style={{
                background: 'color-mix(in oklab, #DA7101 12%, transparent)',
                borderColor: 'color-mix(in oklab, #DA7101 40%, transparent)',
              }}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: '#DA7101' }} />
              <div className="flex-1">
                <div className="font-semibold" style={{ color: '#DA7101' }}>
                  {t(
                    `Не удалось списать оплату (попытка ${entitlement.renewalAttempts} из 3)`,
                    `Payment attempt failed (${entitlement.renewalAttempts} of 3)`,
                  )}
                </div>
                <p className="mt-1 text-muted">
                  {t(
                    'Проверьте, что срок действия карты не истёк и на ней достаточно средств. После 3-й неудачной попытки автопродление будет отменено автоматически.',
                    'Please check that your card is not expired and has sufficient funds. After the 3rd failed attempt, auto-renewal will be cancelled automatically.',
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/checkout?mode=update-card')}
                  className="mt-2 text-[12px] font-medium underline"
                  style={{ color: '#DA7101' }}
                >
                  {t('Обновить способ оплаты', 'Update payment method')}
                </button>
              </div>
            </div>
          )}

          {/* Статус автопродления */}
          <div className="flex justify-between items-start gap-3">
            <div className="flex-1">
              <div className="text-[12px] text-muted uppercase tracking-wide">
                {t('Автопродление', 'Auto-renewal')}
              </div>
              <div className="text-[13px] font-medium mt-0.5">
                {entitlement.cancelAtPeriodEnd
                  ? t('Отменено', 'Cancelled')
                  : entitlement.autoRenew
                    ? t('Включено', 'Enabled')
                    : t('Не настроено', 'Not set up')}
              </div>
              {entitlement.cancelAtPeriodEnd && entitlement.validUntil && (
                <p className="text-[11px] text-muted mt-1">
                  {t(
                    `Доступ сохраняется до ${entitlement.validUntil.toLocaleDateString('ru-RU')}, дальше — Free.`,
                    `Access until ${entitlement.validUntil.toLocaleDateString('en-US')}, then downgrades to Free.`,
                  )}
                </p>
              )}
              {!entitlement.cancelAtPeriodEnd && entitlement.autoRenew && entitlement.nextRenewalAt && (
                <p className="text-[11px] text-muted mt-1">
                  {t(
                    `Следующее списание: ${entitlement.nextRenewalAt.toLocaleDateString('ru-RU')}`,
                    `Next charge: ${entitlement.nextRenewalAt.toLocaleDateString('en-US')}`,
                  )}
                </p>
              )}
            </div>
            {entitlement.autoRenew && !entitlement.cancelAtPeriodEnd && (
              <button
                type="button"
                onClick={() => setCancelConfirmOpen(true)}
                disabled={cancelBusy}
                className="text-[12px] px-3 py-1.5 rounded-md border border-border-soft hover:bg-surface disabled:opacity-60 flex items-center gap-1.5"
              >
                <Ban size={12} />
                {t('Отменить', 'Cancel')}
              </button>
            )}
            {entitlement.cancelAtPeriodEnd && entitlement.paymentMethodId && (
              <button
                type="button"
                onClick={handleReactivateSubscription}
                disabled={reactivateBusy}
                style={{ background: 'var(--accent, #01696F)' }}
                className="text-white text-[12px] px-3 py-1.5 rounded-md disabled:opacity-60 flex items-center gap-1.5"
              >
                <RotateCcw size={12} />
                {reactivateBusy
                  ? t('Включаем…', 'Enabling…')
                  : t('Включить обратно', 'Re-enable')}
              </button>
            )}
          </div>

          {/* v0.9.35-dev.6.6 — Upgrade monthly → annual */}
          {entitlement.effectivePlan === 'pro' && (() => {
            // Показываем только если подписка monthly (daysLeft ≤ 40 = точно monthly)
            const isMonthly = daysLeft != null && daysLeft <= 40;
            if (!isMonthly) return null;
            return (
              <div className="border-t border-border-soft pt-3">
                <div className="text-[12px] text-muted uppercase tracking-wide mb-2">
                  {t('Управление планом', 'Plan management')}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium">{t('Перейти на годовый', 'Upgrade to Annual')}</p>
                    <p className="text-[11px] text-muted mt-0.5">
                      {t('+365 дней к текущему периоду за 2 990 ₽', '+365 days added to current period — 2,990 ₽')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUpgradeConfirmOpen(true)}
                    disabled={upgradeBusy}
                    style={{ background: 'var(--accent, #01696F)' }}
                    className="text-white text-[12px] px-3 py-1.5 rounded-md disabled:opacity-60 flex items-center gap-1.5 shrink-0"
                  >
                    <Sparkles size={12} />
                    {t('Перейти', 'Upgrade')}
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Способ оплаты (маска карты) */}
          <div className="border-t border-border-soft pt-3">
            <div className="text-[12px] text-muted uppercase tracking-wide mb-1.5">
              {t('Способ оплаты', 'Payment method')}
            </div>
            {pmLoading && <p className="text-[12px] text-muted">{t('Загрузка…', 'Loading…')}</p>}
            {!pmLoading && paymentMethods.length === 0 && (
              <p className="text-[12px] text-muted">
                {t('Карта не привязана. Автопродление невозможно.', 'No card linked. Auto-renewal not available.')}
              </p>
            )}
            {!pmLoading && paymentMethods.length > 0 && paymentMethods.map((pm) => {
              const expStr = (pm.card_expiry_month != null && pm.card_expiry_year != null)
                ? ` · ${String(pm.card_expiry_month).padStart(2, '0')}/${String(pm.card_expiry_year).slice(-2)}`
                : '';
              const brandStr = pm.card_brand ? pm.card_brand.toUpperCase() : t('Карта', 'Card');
              return (
                <div key={pm.id} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CreditCard size={14} className="text-muted shrink-0" />
                    <span className="text-[13px] font-mono tabular-nums">
                      {brandStr} •••• {pm.card_last4 ?? '••••'}{expStr}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => navigate('/checkout?mode=update-card')}
                      className="text-[12px] underline text-muted hover:text-fg"
                    >
                      {t('Обновить', 'Update')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetachConfirmOpen(true)}
                      disabled={detachBusy}
                      className="text-[12px] px-2.5 py-1 rounded-md border border-border-soft hover:bg-surface disabled:opacity-60 flex items-center gap-1.5"
                    >
                      <Unlink size={12} />
                      {detachBusy ? t('Отвязываем…', 'Detaching…') : t('Отвязать', 'Detach')}
                    </button>
                  </div>
                </div>
              );
            })}
            {!pmLoading && paymentMethods.length === 0 && entitlement.autoRenew === false && (
              <button
                type="button"
                onClick={() => navigate('/checkout?mode=update-card')}
                className="mt-2 text-[12px] px-3 py-1.5 rounded-md border border-border-soft hover:bg-surface flex items-center gap-1.5"
              >
                <CreditCard size={12} />
                {t('Привязать карту', 'Link card')}
              </button>
            )}
          </div>

          <p className="text-[11px] text-muted flex items-start gap-1 border-t border-border-soft pt-3">
            <Info size={11} className="mt-0.5 shrink-0" />
            {t(
              'Отмена автопродления не возвращает деньги за текущий период — вы просто перестанете платить в будущем. Для возврата обратитесь в поддержку.',
              'Cancelling auto-renewal does not refund the current period — you simply stop paying in the future. For a refund, contact support.',
            )}
          </p>
        </div>
      )}

      {/* Модалка подтверждения отмены */}
      <ConfirmDialog
        open={cancelConfirmOpen}
        title={t('Отменить автопродление?', 'Cancel auto-renewal?')}
        message={
          validUntilStr
            ? t(
                `Доступ к Pro-функциям сохранится до ${validUntilStr}, дальше аккаунт вернётся на Free. Деньги за текущий период не возвращаются.`,
                `Pro access remains until ${validUntilStr}, then the account downgrades to Free. The current period is non-refundable.`,
              )
            : t(
                'Доступ к Pro-функциям сохранится до конца оплаченного периода.',
                'Pro access remains until the end of the paid period.',
              )
        }
        confirmLabel={cancelBusy ? t('Отменяем…', 'Cancelling…') : t('Отменить автопродление', 'Cancel auto-renewal')}
        cancelLabel={t('Оставить', 'Keep')}
        danger
        onConfirm={handleCancelSubscription}
        onCancel={() => setCancelConfirmOpen(false)}
      />

      {/* Модалка подтверждения отвязки карты (v0.9.35-dev.6.5.2) */}
      <ConfirmDialog
        open={detachConfirmOpen}
        title={t('Отвязать карту?', 'Detach card?')}
        message={t(
          'Карта будет удалена из сервиса, автопродление отключится. Доступ к Pro-функциям сохранится до конца оплаченного периода. Чтобы снова включить автопродление, потребуется привязать карту заново.',
          'The card will be removed from the service and auto-renewal will be disabled. Pro access remains until the end of the paid period. To re-enable auto-renewal, you will need to link a card again.',
        )}
        confirmLabel={detachBusy ? t('Отвязываем…', 'Detaching…') : t('Отвязать карту', 'Detach card')}
        cancelLabel={t('Отмена', 'Cancel')}
        danger
        onConfirm={handleDetachPaymentMethod}
        onCancel={() => setDetachConfirmOpen(false)}
      />

      {/* v0.9.35-dev.6.6 — Upgrade confirm */}
      <ConfirmDialog
        open={upgradeConfirmOpen}
        title={t('Перейти на годовый план?', 'Upgrade to Annual?')}
        message={t(
          'С вашей привязанной карты будет списано 2 990 ₽. К вашему текущему периоду добавится +365 дней.',
          'Your saved card will be charged 2,990 ₽. +365 days will be added to your current period.',
        )}
        confirmLabel={upgradeBusy ? t('Обрабатываем…', 'Processing…') : t('Перейти за 2 990 ₽', 'Upgrade for 2,990 ₽')}
        cancelLabel={t('Отмена', 'Cancel')}
        onConfirm={() => void handleUpgradePlan()}
        onCancel={() => setUpgradeConfirmOpen(false)}
      />

      {/* ──── Trial CTA — v0.9.35-dev.6.8: привязка карты обязательна ──── */}
      {/* v0.9.35-dev.6.8.1: guard !subsLoading убирает flash-of-free — CTA
          «Попробуйте Pro бесплатно» больше не мелькает на секунду при переходе
          на вкладку, пока entitlement ещё грузится из кэша. */}
      {!subsLoading && canStartTrial && (
        <div
          className="rounded-lg p-4 space-y-3 border"
          style={{
            background: 'color-mix(in oklab, var(--accent, #01696F) 8%, transparent)',
            borderColor: 'color-mix(in oklab, var(--accent, #01696F) 30%, transparent)',
          }}
        >
          <div className="flex items-start gap-2">
            <Sparkles size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--accent, #01696F)' }} />
            <div className="flex-1">
              <h4 className="text-[14px] font-semibold">{t('Попробуйте Pro бесплатно', 'Try Pro for free')}</h4>
              <p className="text-[12px] text-muted mt-1">
                {t(
                  '14 дней всех функций Pro. После trial — 299 ₽/мес, отмена в любой момент.',
                  '14 days of all Pro features. After trial — ₽299/mo, cancel anytime.',
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/checkout?mode=trial')}
            style={{ background: 'var(--accent, #01696F)' }}
            className="text-white px-3 py-1.5 text-[13px] rounded-md"
          >
            {t('Начать бесплатный trial', 'Start free trial')}
          </button>
        </div>
      )}

      {/* ──── Оформить подписку (→ /checkout) — скрыто для pro/lifetime ──── */}
      {/* v0.9.35-dev.6.4.1: кнопка активна, каждый тариф — кликабельный ряд,
          ведёт на /checkout?tier={monthly|annual|lifetime}. Cloud/YooKassa уже подключены (dev.6.4).
          v0.9.35-dev.6.7: скрыт если у пользователя уже активная подписка. */}
      {!subsLoading && !entitlement.isPaidPro && <div className="bg-surface-alt border border-border-soft rounded-lg p-4 space-y-3">
        <h4 className="text-[14px] font-semibold flex items-center gap-2">
          <Cloud size={14} />
          {t('Оформить подписку', 'Purchase subscription')}
        </h4>
        <div className="space-y-1.5 text-[13px]">
          <button
            type="button"
            onClick={() => navigate('/checkout?tier=monthly')}
            className="w-full flex justify-between items-center px-3 py-2 rounded-md border border-border-soft/60 hover:bg-surface transition-colors"
          >
            <span>{t('Ежемесячно', 'Monthly')}</span>
            <span className="font-medium tabular-nums">
              {PRICE_MONTHLY} / {t('мес', 'mo')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/checkout?tier=annual')}
            className="w-full flex justify-between items-center px-3 py-2 rounded-md border transition-colors"
            style={{
              background: 'color-mix(in oklab, var(--accent, #01696F) 8%, transparent)',
              borderColor: 'color-mix(in oklab, var(--accent, #01696F) 30%, transparent)',
            }}
          >
            <span className="flex items-center gap-2">
              {t('Ежегодно', 'Annual')}
              <span className="text-[10px] px-1.5 py-0.5 rounded text-white font-medium leading-none" style={{ background: 'var(--accent, #01696F)' }}>
                {t('выгодно', 'best')}
              </span>
            </span>
            <span className="font-medium tabular-nums">
              {PRICE_ANNUAL} / {t('год', 'yr')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/checkout?tier=lifetime')}
            className="w-full flex justify-between items-center px-3 py-2 rounded-md border border-border-soft/60 hover:bg-surface transition-colors"
          >
            <span>Lifetime</span>
            <span className="font-medium tabular-nums">
              {PRICE_LIFETIME}
            </span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => navigate('/checkout')}
          style={{ background: 'var(--accent, #01696F)' }}
          className="w-full px-3 py-2 text-[13px] rounded-md text-white font-medium hover:opacity-90 transition-opacity"
        >
          {t('Оплатить картой', 'Pay by card')}
        </button>
        <p className="text-[11px] text-muted flex items-start gap-1">
          <Info size={11} className="mt-0.5 shrink-0" />
          {t(
            'Оплата через ЮKassa. Пока магазин в test-режиме (prod-модерация). Автопродление появится в ближайшем релизе.',
            'Payment via YooKassa. Store is in test mode (prod moderation). Auto-renewal comes in the next release.',
          )}
        </p>
      </div>}

      {/* ──── Альтернативные способы оплаты — скрыты для pro/lifetime ──── */}
      {!subsLoading && !entitlement.isPaidPro && PAYMENT_METHODS.length > 0 && (
        <details className="bg-surface-alt border border-border-soft rounded-lg">
          <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold flex items-center gap-2">
            <ExternalLink size={14} />
            {t('Альтернативные способы оплаты', 'Alternative payment methods')}
          </summary>
          <div className="px-4 pb-4 space-y-3">
            <p className="text-[12px] text-muted">
              {PRICE_LINE
                ? t(
                    `Переведите нужную сумму (${PRICE_LINE}) любым способом, скопируйте ID транзакции или хэш перевода и вставьте в форму ниже. Проверка занимает до 24 часов.`,
                    `Transfer the required amount (${PRICE_LINE}) by any method, copy the transaction ID or transfer hash, and paste it in the form below. Review takes up to 24 hours.`,
                  )
                : t(
                    'Переведите нужную сумму любым способом, скопируйте ID транзакции или хэш перевода и вставьте в форму ниже. Проверка занимает до 24 часов.',
                    'Transfer the required amount by any method, copy the transaction ID or transfer hash, and paste it in the form below. Review takes up to 24 hours.',
                  )}
            </p>

            {PAYMENT_METHODS.map((m) => (
              <div key={m.key} className="border border-border-soft rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold uppercase tracking-wide">{m.label}</span>
                  {m.linkUrl && (
                    <a
                      href={m.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] flex items-center gap-1"
                      style={{ color: 'var(--accent, #01696F)' }}
                    >
                      {t('Открыть', 'Open')} <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-[11px] flex-1 bg-surface px-2 py-1 rounded font-mono break-all">
                    {m.displayValue}
                  </code>
                  <button
                    onClick={() => copyToClipboard(m.value, m.label)}
                    className="p-1.5 rounded hover:bg-surface"
                    title={t('Скопировать', 'Copy')}
                  >
                    <Copy size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ──── Форма ручной активации — свёрнута по умолчанию, скрыта для pro/lifetime ──── */}
      {!subsLoading && !entitlement.isPaidPro && <details className="bg-surface-alt border border-border-soft rounded-lg">
        <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold flex items-center gap-2">
          <KeyRound size={14} />
          {t('Ручная активация', 'Manual activation')}
        </summary>
        <div className="px-4 pb-4 space-y-3">
        <p className="text-[12px] text-muted">
          {t(
            'Отправили платёж? Оставьте заявку — админ проверит и активирует подписку.',
            'Made a payment? Submit a request — admin will verify and activate your subscription.',
          )}
        </p>

        <div className="space-y-2">
          <label className="block">
            <span className="text-[12px] text-muted uppercase tracking-wide">
              {t('Email аккаунта', 'Account email')}
            </span>
            <input
              type="text"
              value={userEmail ?? ''}
              disabled
              className="w-full mt-1 px-2 py-1.5 text-[13px] rounded-md border border-border-soft bg-surface opacity-70"
            />
          </label>

          <label className="block">
            <span className="text-[12px] text-muted uppercase tracking-wide">
              {t('Тариф', 'Plan')}
            </span>
            <select
              value={planRequested}
              onChange={e => setPlanRequested(e.target.value as 'monthly' | 'annual' | 'lifetime')}
              className="w-full mt-1 px-2 py-1.5 text-[13px] rounded-md border border-border-soft bg-surface"
            >
              <option value="monthly">
                {t('Ежемесячно', 'Monthly')}{PRICE_MONTHLY ? ` — ${PRICE_MONTHLY}` : ''}
              </option>
              <option value="annual">
                {t('Ежегодно', 'Annual')}{PRICE_ANNUAL ? ` — ${PRICE_ANNUAL}` : ''}
              </option>
              <option value="lifetime">
                Lifetime{PRICE_LIFETIME ? ` — ${PRICE_LIFETIME}` : ''}
              </option>
            </select>
          </label>

          <label className="block">
            <span className="text-[12px] text-muted uppercase tracking-wide">
              {t('Способ оплаты', 'Payment method')}
            </span>
            <select
              value={providerHint}
              onChange={e => setProviderHint(e.target.value as any)}
              className="w-full mt-1 px-2 py-1.5 text-[13px] rounded-md border border-border-soft bg-surface"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
              <option value="other">{t('Другой', 'Other')}</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[12px] text-muted uppercase tracking-wide">
              {t('ID транзакции / хэш перевода', 'Transaction ID / transfer hash')} *
            </span>
            <input
              type="text"
              value={txRef}
              onChange={e => setTxRef(e.target.value)}
              placeholder={t('например, 0xabc… или ID платежа провайдера', 'e.g. 0xabc… or provider payment ID')}
              className="w-full mt-1 px-2 py-1.5 text-[13px] rounded-md border border-border-soft bg-surface font-mono"
            />
          </label>

          <label className="block">
            <span className="text-[12px] text-muted uppercase tracking-wide">
              {t('Комментарий (необязательно)', 'Notes (optional)')}
            </span>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder={t('дата, сумма, время перевода…', 'date, amount, transfer time…')}
              className="w-full mt-1 px-2 py-1.5 text-[13px] rounded-md border border-border-soft bg-surface"
            />
          </label>
        </div>

        <button
          onClick={handleSubmitActivation}
          disabled={submitting || !txRef.trim()}
          style={{ background: 'var(--accent, #01696F)' }}
          className="text-white px-3 py-1.5 text-[13px] rounded-md disabled:opacity-60"
        >
          {submitting ? t('Отправляем…', 'Submitting…') : t('Отправить заявку', 'Submit request')}
        </button>
        </div>
      </details>}

      {/* ──── История заявок — свёрнута по умолчанию, скрыта для pro/lifetime ──── */}
      {!subsLoading && !entitlement.isPaidPro && <details className="bg-surface-alt border border-border-soft rounded-lg">
        <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold flex items-center gap-2 justify-between">
          <span className="flex items-center gap-2">
            <Clock size={14} />
            {t('Мои заявки', 'My requests')}
          </span>
          <button
            onClick={(e) => { e.preventDefault(); void reloadRequests(); }}
            disabled={reqLoading}
            className="p-1 rounded hover:bg-surface"
            title={t('Обновить', 'Refresh')}
          >
            <RefreshCw size={12} className={reqLoading ? 'animate-spin' : ''} />
          </button>
        </summary>
        <div className="px-4 pb-4 space-y-2">
        {requests.length === 0 && !reqLoading && (
          <p className="text-[12px] text-muted">
            {t('Заявок ещё нет.', 'No requests yet.')}
          </p>
        )}
        {reqLoading && requests.length === 0 && (
          <p className="text-[12px] text-muted">{t('Загрузка…', 'Loading…')}</p>
        )}
        {requests.length > 0 && (
          <ul className="space-y-2">
            {requests.map(r => (
              <li key={r.id} className="border border-border-soft rounded-md p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium">
                    {planLabelForRequest(r.plan_requested, isRu)}
                    <span className="text-muted ml-1.5">· {r.provider_hint}</span>
                  </span>
                  <RequestStatusBadge status={r.status} isRu={isRu} />
                </div>
                <div className="text-[11px] text-muted font-mono break-all">
                  tx: {r.tx_ref}
                </div>
                <div className="text-[11px] text-muted">
                  {new Date(r.created_at).toLocaleString(isRu ? 'ru-RU' : 'en-US')}
                </div>
                {r.admin_notes && (
                  <div className="text-[11px] italic pt-1 border-t border-border-soft">
                    {r.admin_notes}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        </div>
      </details>}

      {/* v0.9.35-dev.6.6 — Admin link */}
      {entitlement.isAdmin && (
        <div className="pt-2 border-t border-border-soft">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="flex items-center gap-1.5 text-[12px] text-muted hover:text-accent transition-colors"
          >
            <Shield size={12} />
            {t('Администрирование', 'Administration')}
          </button>
        </div>
      )}

      {/* ──── Footer info ──── */}
      <details className="text-[12px] text-muted">
        <summary className="cursor-pointer">{t('Что даёт подписка?', 'What does the subscription include?')}</summary>
        <ul className="mt-2 space-y-1 pl-4 list-disc">
          <li>{t('Синхронизация задач между устройствами', 'Task sync across devices')}</li>
          <li>{t('Календарь и напоминания', 'Calendar and reminders')}</li>
          <li>{t('Real-time обновления', 'Real-time updates')}</li>
          <li>{t('Приоритет в поддержке', 'Priority support')}</li>
        </ul>
      </details>
    </div>
  );
}

// Строка из таблицы activation_requests, ограниченная теми колонками,
// что нужны UI. См. миграцию 0007_entitlements.sql.
interface ActivationRequestRow {
  id: string;
  created_at: string;
  plan_requested: 'monthly' | 'annual' | 'lifetime';
  provider_hint: string;
  tx_ref: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_notes: string | null;
}

function planLabelForRequest(plan: 'monthly' | 'annual' | 'lifetime', isRu: boolean): string {
  switch (plan) {
    case 'monthly': return isRu ? 'Ежемесячно' : 'Monthly';
    case 'annual': return isRu ? 'Ежегодно' : 'Annual';
    case 'lifetime': return 'Lifetime';
  }
}

function RequestStatusBadge({ status, isRu }: { status: 'pending' | 'approved' | 'rejected'; isRu: boolean }) {
  const cfg = (() => {
    switch (status) {
      case 'pending':
        return {
          icon: <Clock size={11} />,
          label: isRu ? 'На проверке' : 'Pending',
          color: '#DA7101',
        };
      case 'approved':
        return {
          icon: <CheckCircle2 size={11} />,
          label: isRu ? 'Одобрена' : 'Approved',
          color: '#437A22',
        };
      case 'rejected':
        return {
          icon: <XCircle size={11} />,
          label: isRu ? 'Отклонена' : 'Rejected',
          color: '#A12C7B',
        };
    }
  })();
  return (
    <span
      className="text-[11px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1"
      style={{
        background: `color-mix(in oklab, ${cfg.color} 15%, transparent)`,
        color: cfg.color,
      }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}
