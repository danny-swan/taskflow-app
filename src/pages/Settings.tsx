import { useState, useRef } from 'react';
import { useStore, ThemeName } from '../store/useStore';
import { tr } from '../lib/i18n';
import { Trash2, GripVertical, Plus, Check, Sun, Moon, Sparkles, Leaf, Download, Upload, HardDrive, AlertTriangle, FolderOpen, Info } from 'lucide-react';
import { downloadFile } from '../lib/utils';
import { resetDatabase, isTauri, buildBackup, applyBackup, type BackupPayload } from '../lib/db';
import { ConfirmDialog } from '../components/ConfirmDialog';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

type Sub = 'general' | 'tags' | 'statuses' | 'stats' | 'theme' | 'io' | 'storage';

export function SettingsPage() {
  const lang = useStore(s => s.language);
  const [sub, setSub] = useState<Sub>('general');

  const subs: { key: Sub; label: string }[] = [
    { key: 'general', label: tr(lang, 'settings_general') },
    { key: 'tags', label: tr(lang, 'settings_tags') },
    { key: 'statuses', label: tr(lang, 'settings_statuses') },
    { key: 'stats', label: tr(lang, 'settings_stats') },
    { key: 'theme', label: tr(lang, 'settings_theme') },
    { key: 'io', label: tr(lang, 'settings_io') },
    { key: 'storage', label: tr(lang, 'storage_section') },
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
        {sub === 'tags' && <TagsSection />}
        {sub === 'statuses' && <StatusesSection />}
        {sub === 'stats' && <StatsToggleSection />}
        {sub === 'theme' && <ThemeSection />}
        {sub === 'io' && <IOSection />}
        {sub === 'storage' && <StorageSection />}
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
        <input
          type="range" min={12} max={18} value={fontSize}
          onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
          className="w-full"
        />
      </Row>

      <Row label={tr(lang, 'default_tab')}>
        <select
          value={defaultTab}
          onChange={(e) => setDefaultTab(e.target.value)}
          className="bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
        >
          {/* v0.8.6: «Добавить» убрана из вкладок-по-умолчанию */}
          <option value="tasks">{tr(lang, 'nav_tasks')}</option>
          <option value="dashboard">{tr(lang, 'nav_dashboard')}</option>
          <option value="stats">{tr(lang, 'nav_stats')}</option>
        </select>
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
            <button
              onClick={() => setConfirmId(s.id)}
              className="p-1 text-muted hover:text-[var(--status-important)]"
            ><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted mt-2">
        {lang === 'ru'
          ? '«Скрытый» — статус не показывается на доске задач. «Свёрнут» — секция свёрнута по умолчанию.'
          : '"Hidden" — status is hidden from the task board. "Collapsed" — section is collapsed by default.'}
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

  const themes: { key: ThemeName; label: string; icon: any; preview: { bg: string; surface: string; accent: string; text: string } }[] = [
    { key: 'light', label: tr(lang, 'theme_light'), icon: Sun, preview: { bg: '#F7F6F2', surface: '#FBFBF9', accent: '#5B7FB8', text: '#28251D' } },
    { key: 'dark', label: tr(lang, 'theme_dark'), icon: Moon, preview: { bg: '#171614', surface: '#1C1B19', accent: '#7FA0D4', text: '#CDCCCA' } },
    { key: 'akatsuki', label: tr(lang, 'theme_akatsuki'), icon: Sparkles, preview: { bg: '#0D0B0F', surface: '#15121A', accent: '#A0212B', text: '#E8E2EE' } },
    { key: 'konoha', label: tr(lang, 'theme_konoha'), icon: Leaf, preview: { bg: '#F4EDD8', surface: '#FAF5E3', accent: '#5B8C3E', text: '#2D2818' } },
  ];

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
    </div>
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
      const total = counts.statuses + counts.tags + counts.tasks;
      pushToast(lang === 'ru'
        ? `Импортировано: ${counts.tasks} задач, ${counts.tags} тэгов, ${counts.statuses} статусов (всего ${total})`
        : `Imported: ${counts.tasks} tasks, ${counts.tags} tags, ${counts.statuses} statuses (total ${total})`);
    } catch (e) {
      console.error('backup import error:', e);
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
                <div className="text-muted">
                  ⚠️ Размещать <span className="font-mono text-text">data.db</span> в облачных папках (OneDrive, Dropbox, Яндекс.Диск, Google Drive) не рекомендуется: SQLite блокирует файл во время работы, и синхронизация может повредить базу. Для переноса на другой ПК используйте <span className="text-text">Экспорт/Импорт</span> в формате JSON/XLSX.
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
                <div className="text-muted">
                  ⚠️ Placing <span className="font-mono text-text">data.db</span> inside cloud-synced folders (OneDrive, Dropbox, Google Drive, Yandex.Disk) is not recommended: SQLite locks the file while the app runs and sync can corrupt the database. To move data to another PC, use <span className="text-text">Export/Import</span> in JSON or XLSX format.
                </div>
              </>
            )}
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
