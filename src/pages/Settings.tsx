import { useState, useRef, useEffect } from 'react';
import { useStore, ThemeName } from '../store/useStore';
import { tr } from '../lib/i18n';
import { Trash2, GripVertical, Plus, Check, Sun, Moon, Sparkles, Leaf, Palette, Download, Upload, HardDrive, AlertTriangle, FolderOpen, Info, FileText, Pencil, RefreshCw, LogOut, User, Shield, KeyRound, Mail } from 'lucide-react';
import { checkForUpdate, downloadAndInstall, type UpdateInfo } from '../lib/updater';
import { useAuth, signOut, deleteAccount, updateEmail } from '../lib/auth';
import { logEvent } from '../lib/telemetry';
import { PrivacyModal } from '../components/PrivacyModal';
import { PasswordResetModal } from '../components/PasswordResetModal';
import { usePrompt } from '../components/PromptDialog';
import pkg from '../../package.json';
import { downloadFile } from '../lib/utils';
import { resetDatabase, isTauri, buildBackup, applyBackup, getSchemaVersion, type BackupPayload } from '../lib/db';
import { logger } from '../lib/logger';
import { ConfirmDialog } from '../components/ConfirmDialog';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

type Sub = 'general' | 'account' | 'tags' | 'statuses' | 'stats' | 'theme' | 'templates' | 'io' | 'storage' | 'updates';

export function SettingsPage() {
  const lang = useStore(s => s.language);
  const [sub, setSub] = useState<Sub>('general');

  const subs: { key: Sub; label: string }[] = [
    { key: 'general', label: tr(lang, 'settings_general') },
    { key: 'account', label: lang === 'ru' ? 'Аккаунт' : 'Account' },
    { key: 'tags', label: tr(lang, 'settings_tags') },
    { key: 'statuses', label: tr(lang, 'settings_statuses') },
    { key: 'stats', label: tr(lang, 'settings_stats') },
    { key: 'theme', label: tr(lang, 'settings_theme') },
    { key: 'templates', label: lang === 'ru' ? 'Шаблоны задач' : 'Task templates' },
    { key: 'io', label: tr(lang, 'settings_io') },
    { key: 'storage', label: tr(lang, 'storage_section') },
    { key: 'updates', label: lang === 'ru' ? 'Обновления' : 'Updates' },
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-[200px] shrink-0 border-r border-border-soft py-4 px-2.5 overflow-y-auto">
        {subs.map(s => (
          <button
            key={s.key}
            onClick={() => setSub(s.key)}
            className={'w-full text-left px-3 py-1.5 mb-0.5 rounded-md text-[13px] ' +
              (sub === s.key ? 'bg-accent-soft text-accent font-medium' : 'hover:bg-surface-alt')}
          >{s.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {sub === 'general' && <GeneralSection />}
        {sub === 'account' && <AccountSection />}
        {sub === 'tags' && <TagsSection />}
        {sub === 'statuses' && <StatusesSection />}
        {sub === 'stats' && <StatsToggleSection />}
        {sub === 'theme' && <ThemeSection />}
        {sub === 'templates' && <TemplatesSection lang={lang} />}
        {sub === 'io' && <IOSection />}
        {sub === 'storage' && <StorageSection />}
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
  const autocleanupDay = useStore(s => s.autocleanupDay);
  const autocleanupMinAgeDays = useStore(s => s.autocleanupMinAgeDays);
  const setAutocleanupEnabled = useStore(s => s.setAutocleanupEnabled);
  const setAutocleanupDay = useStore(s => s.setAutocleanupDay);
  const setAutocleanupMinAgeDays = useStore(s => s.setAutocleanupMinAgeDays);
  const runAutoCleanup = useStore(s => s.runAutoCleanup);
  const pushToast = useStore(s => s.pushToast);
  const [cleanNowConfirm, setCleanNowConfirm] = useState(false);

  const dayNames = lang === 'ru'
    ? ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const handleCleanNow = () => {
    const archived = runAutoCleanup({ manual: true });
    if (archived === 0) {
      pushToast(lang === 'ru' ? 'Нечего чистить' : 'Nothing to clean up');
      return;
    }
    const msg = lang === 'ru'
      ? `Архивировано ${archived} ${archived === 1 ? 'задача' : archived < 5 ? 'задачи' : 'задач'}`
      : `Archived ${archived} task${archived === 1 ? '' : 's'}`;
    // Простой toast без Undo — пользователь только что сознательно нажал кнопку в confirm.
    pushToast(msg);
  };

  return (
    <div className="max-w-xl space-y-6">
      <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_general')}</h3>

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

      {/* v0.9.28: автоочистка выполненных задач */}
      <div className="pt-4 border-t border-border-soft">
        <h4 className="font-display text-[14px] font-semibold mb-3">
          {lang === 'ru' ? 'Автоочистка выполненных' : 'Auto-cleanup completed'}
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
                ? 'Автоматически переносить старые выполненные в «Удалено»'
                : 'Move old completed tasks to «Deleted» automatically'}
            </span>
          </label>
        </Row>

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
          {lang === 'ru'
            ? 'В выбранный день недели при запуске приложения все выполненные задачи старше указанного возраста будут тихо перенесены в «Удалено» (они останутся в Статистике). Если вы пропустили этот день — автоочистка сработает при следующем запуске (catch-up).'
            : 'On the selected day of week when the app starts, all completed tasks older than the set age are silently moved to «Deleted» (they remain in Stats). If you missed that day, auto-cleanup will run on next startup (catch-up).'}
        </div>
      </div>

      <ConfirmDialog
        open={cleanNowConfirm}
        title={lang === 'ru' ? 'Почистить сейчас?' : 'Clean up now?'}
        message={lang === 'ru'
          ? `Все выполненные задачи старше ${autocleanupMinAgeDays} дн. будут перенесены в «Удалено». Их можно восстановить в Статистике.`
          : `All completed tasks older than ${autocleanupMinAgeDays} d will be moved to «Deleted». They can be restored from Stats.`}
        confirmLabel={lang === 'ru' ? 'Почистить' : 'Clean up'}
        cancelLabel={tr(lang, 'cancel')}
        onConfirm={() => { handleCleanNow(); setCleanNowConfirm(false); }}
        onCancel={() => setCleanNowConfirm(false)}
      />
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

      {/* v0.9.29: 3 color-picker — видимы только при активной custom-теме */}
      {theme === 'custom' && (
        <div className="mt-5 rounded-xl border border-border-soft bg-surface p-4">
          <p className="text-[12px] text-muted mb-3">{tr(lang, 'theme_custom_hint')}</p>
          <div className="grid grid-cols-3 gap-3">
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

// v0.9.29: отдельный color-picker с native <input type="color"> + hex-текстовым полем
function ColorPickerField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] text-muted uppercase tracking-wide">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border border-border-soft cursor-pointer bg-transparent"
          aria-label={label}
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 h-10 px-2.5 text-[13px] rounded-lg border border-border-soft bg-bg text-text focus:outline-none focus:border-accent font-mono uppercase"
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
    const stamp = new Date().toISOString().slice(0, 10);
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
      ['Пример задачи', 'Описание задачи', 'В работе', 'dev', new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)],
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

  const tauri = isTauri();

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
          <button
            type="button"
            onClick={install}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-[13px] rounded-md bg-accent text-white hover:opacity-90"
          >
            <Download className="w-4 h-4" />
            {lang === 'ru' ? 'Скачать и установить' : 'Download and install'}
          </button>
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
