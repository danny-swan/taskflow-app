import { useState } from 'react';
import { useStore, ThemeName } from '../store/useStore';
import { tr } from '../lib/i18n';
import { Trash2, GripVertical, Plus, Check, Sun, Moon, Sparkles, Leaf, Download, Upload } from 'lucide-react';
import { downloadFile } from '../lib/utils';
import { exportJson, exportCsv, resetDatabase } from '../lib/db';

type Sub = 'general' | 'tags' | 'statuses' | 'stats' | 'theme' | 'io';

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
          <option value="tasks">{tr(lang, 'nav_tasks')}</option>
          <option value="add">{tr(lang, 'nav_add')}</option>
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

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_tags')}</h3>
        <button
          onClick={() => addTag('NEW' + (tags.length + 1), '#5B7FB8')}
          className="flex items-center gap-1 px-2.5 py-1 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
        ><Plus size={13} /> {tr(lang, 'add_tag')}</button>
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
              onClick={() => { if (confirm(tr(lang, 'confirm_delete'))) deleteTag(t.id); }}
              className="p-1 text-muted hover:text-[var(--status-important)]"
            ><Trash2 size={14} /></button>
          </div>
        ))}
        {tags.length === 0 && <div className="px-3 py-8 text-center text-muted text-[13px]">—</div>}
      </div>
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

  const move = (i: number, dir: -1 | 1) => {
    const ids = statuses.map(s => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorderStatuses(ids);
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_statuses')}</h3>
        <button
          onClick={() => addStatus('Новый', '#5B7FB8', 'middle')}
          className="flex items-center gap-1 px-2.5 py-1 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
        ><Plus size={13} /> {tr(lang, 'add_status')}</button>
      </div>
      <div className="border border-border-soft rounded-lg max-h-[60vh] overflow-y-auto bg-surface">
        {statuses.filter(s => s.is_technical !== 1).map((s, i) => (
          <div key={s.id} className="flex items-center gap-3 px-3 py-2 border-b border-border-soft last:border-b-0">
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
            <select
              value={s.behavior}
              onChange={(e) => updateStatus(s.id, { behavior: e.target.value })}
              className="bg-surface-alt border border-border-soft rounded px-2 py-1 text-[12px]"
            >
              <option value="top">{tr(lang, 'behavior_top')}</option>
              <option value="middle">{tr(lang, 'behavior_middle')}</option>
              <option value="bottom">{tr(lang, 'behavior_bottom')}</option>
              <option value="archive">{tr(lang, 'behavior_archive')}</option>
            </select>
            <button
              onClick={() => { if (confirm(tr(lang, 'confirm_delete'))) deleteStatus(s.id); }}
              className="p-1 text-muted hover:text-[var(--status-important)]"
            ><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
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
      <p className="text-[12px] text-muted">Когда выключено — вкладка «Статистика» скрыта.</p>
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

function IOSection() {
  const lang = useStore(s => s.language);
  const pushToast = useStore(s => s.pushToast);

  const handleExportCsv = () => {
    downloadFile('taskflow.csv', exportCsv(), 'text/csv');
    pushToast(tr(lang, 'exported'));
  };
  const handleExportJson = () => {
    downloadFile('taskflow.json', JSON.stringify(exportJson(), null, 2), 'application/json');
    pushToast(tr(lang, 'exported'));
  };
  const handleReset = () => {
    if (confirm('Стереть базу и пересоздать?')) {
      resetDatabase();
      window.location.reload();
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'settings_io')}</h3>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={handleExportCsv} className="flex items-center gap-2 px-4 py-3 border border-border-soft rounded-lg hover:bg-surface-alt text-[13px]">
          <Download size={16} /> {tr(lang, 'export_csv')}
        </button>
        <button onClick={handleExportJson} className="flex items-center gap-2 px-4 py-3 border border-border-soft rounded-lg hover:bg-surface-alt text-[13px]">
          <Download size={16} /> {tr(lang, 'export_json')}
        </button>
      </div>

      <div className="px-4 py-3 border border-border-soft rounded-lg bg-surface-alt flex items-center gap-2">
        <Upload size={16} className="text-muted" />
        <div>
          <div className="text-[13px] font-medium">Импорт из .xlsx</div>
          <div className="text-[12px] text-muted">{tr(lang, 'coming_soon')} — пока используйте CSV-импорт через ручную миграцию.</div>
        </div>
      </div>

      <button
        onClick={handleReset}
        className="px-3 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-[var(--status-important)] hover:text-white text-muted"
      >Сбросить базу</button>
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
