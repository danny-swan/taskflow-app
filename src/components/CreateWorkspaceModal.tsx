// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// CreateWorkspaceModal — создание пространства (Wave A, PR-4).
//
// Поле «Название» (1–60, trim) + селектор типа personal/shared. Для free-юзера
// тип shared задизейблен с тултипом (dev-стаб на useEntitlement; полная логика
// тарифов — PR-5). На «Создать» → store.createWorkspace(name, kind), которое
// делает локальный INSERT + owner-membership + enqueueOutbox + switchWorkspace.
import { useState } from 'react';
import { User as UserIcon, Users } from 'lucide-react';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import { useEntitlement, isProOrTrial } from '../lib/entitlements';

export function CreateWorkspaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lang = useStore(s => s.language);
  const createWorkspace = useStore(s => s.createWorkspace);
  const auth = useAuth();
  const { entitlement } = useEntitlement(auth.user?.id ?? null, auth.user?.email ?? null);
  // Dev-стаб гейта shared: доступно только Pro/Trial (полная логика — PR-5).
  const canShared = isProOrTrial(entitlement);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'personal' | 'shared'>('personal');

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 60;

  const reset = () => { setName(''); setKind('personal'); };
  const handleClose = () => { reset(); onClose(); };

  const submit = () => {
    if (!valid) return;
    const effectiveKind = kind === 'shared' && !canShared ? 'personal' : kind;
    createWorkspace(trimmed, effectiveKind);
    handleClose();
  };

  const typeBtn = (
    value: 'personal' | 'shared',
    label: string,
    Icon: typeof UserIcon,
    disabled: boolean,
    title?: string,
  ) => (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={() => setKind(value)}
      aria-pressed={kind === value}
      className={
        'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-[13px] transition-colors ' +
        (disabled
          ? 'border-border-soft text-faint cursor-not-allowed'
          : kind === value
            ? 'bg-accent text-white border-accent'
            : 'border-border-soft hover:bg-surface-alt')
      }
    >
      <Icon size={15} />
      {label}
    </button>
  );

  return (
    <Modal open={open} onClose={handleClose} width={420} label={tr(lang, 'ws_create_title')}>
      <div className="p-5 flex flex-col gap-4">
        <h2 className="font-display text-[16px] font-semibold">{tr(lang, 'ws_create_title')}</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">{tr(lang, 'ws_name_label')}</span>
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && valid) submit(); }}
            placeholder={tr(lang, 'ws_name_placeholder')}
            className="bg-surface-alt border border-border-soft rounded-lg px-3 py-2 text-[14px] outline-none focus:border-accent"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">{tr(lang, 'ws_type_label')}</span>
          <div className="flex gap-2">
            {typeBtn('personal', tr(lang, 'ws_type_personal'), UserIcon, false)}
            {typeBtn(
              'shared', tr(lang, 'ws_type_shared'), Users,
              !canShared, !canShared ? tr(lang, 'ws_shared_paid_hint') : undefined,
            )}
          </div>
          {!canShared && (
            <span className="text-[11px] text-faint">{tr(lang, 'ws_shared_paid_hint')}</span>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-[13px] border border-border-soft rounded-lg hover:bg-surface-alt transition-colors"
          >
            {tr(lang, 'cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className={
              'px-4 py-2 text-[13px] rounded-lg font-medium transition-colors text-white ' +
              (valid ? 'bg-accent hover:bg-accent-hover' : 'bg-accent/40 cursor-not-allowed')
            }
          >
            {tr(lang, 'ws_create_action')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
