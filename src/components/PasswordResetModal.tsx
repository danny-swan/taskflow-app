/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.14 — Модалка ввода нового пароля.
 *
 *   Показывается после recovery deep-link из письма Supabase. К этому моменту
 *   сессия уже установлена (handleAuthCallback вызвал setSession), поэтому
 *   updatePassword() выполняется под этой временной сессией и заменяет пароль
 *   пользователя.
 *
 * v0.9.15 — Два режима работы:
 *   - mode="reset"  (default) — recovery flow, пароль меняется под recovery-
 *                     сессией без ввода старого. Используется из App.tsx при
 *                     type=recovery deep-link.
 *   - mode="change" — обычная смена пароля из Settings. ТРЕБУЕТ ввода текущего
 *                     пароля (reauthenticate через signInWithPassword). Если
 *                     старый пароль не совпадает — updatePassword не вызывается,
 *                     пользователь видит понятную ошибку.
 *   + иконка «глаз» для всех password-полей: клик переключает type между
 *     password и text.
 */
import { useState } from 'react';
import { Lock, AlertCircle, Loader2, KeyRound, Eye, EyeOff } from 'lucide-react';
import { updatePassword, signInWithPassword } from '../lib/auth';
import { useStore } from '../store/useStore';

interface Props {
  onClose: () => void;
  /** default 'reset'. 'change' требует ввода текущего пароля. */
  mode?: 'reset' | 'change';
  /** для mode='change' — email текущего пользователя (для reauthenticate). */
  userEmail?: string;
}

export function PasswordResetModal({ onClose, mode = 'reset', userEmail }: Props) {
  const lang = useStore(s => s.language);
  const pushToast = useStore(s => s.pushToast);
  const isRu = lang === 'ru';
  const t = (ru: string, en: string) => (isRu ? ru : en);

  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v0.9.15: показ пароля по клику на «глаз». Каждое поле — отдельное состояние.
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const isChange = mode === 'change';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isChange && !currentPassword) {
      setError(t('Введите текущий пароль', 'Enter your current password'));
      return;
    }
    if (password.length < 6) {
      setError(t('Пароль должен быть не короче 6 символов', 'Password must be at least 6 characters'));
      return;
    }
    if (password !== confirm) {
      setError(t('Пароли не совпадают', 'Passwords do not match'));
      return;
    }
    if (isChange && currentPassword === password) {
      setError(t('Новый пароль совпадает с текущим', 'New password matches the current one'));
      return;
    }

    setLoading(true);
    try {
      // v0.9.15: для mode='change' сначала reauthenticate — проверяем, что
      // пользователь помнит текущий пароль. Если нет — ошибка, и обычный
      // flow «Забыли пароль?» на экране входа.
      if (isChange) {
        if (!userEmail) {
          throw new Error(t('Не удалось определить email пользователя', 'Could not determine user email'));
        }
        try {
          await signInWithPassword(userEmail, currentPassword);
        } catch {
          setError(t(
            'Неверный текущий пароль. Если забыли — выйдите и используйте «Забыли пароль?»',
            'Current password is incorrect. If you forgot it, sign out and use «Forgot password?»',
          ));
          setLoading(false);
          return;
        }
      }
      await updatePassword(password);
      pushToast(t('Пароль обновлён', 'Password updated'));
      onClose();
    } catch (err: any) {
      setError(err?.message ?? t('Ошибка смены пароля', 'Password change failed'));
    } finally {
      setLoading(false);
    }
  };

  // v0.9.15: переиспользуемый password-input с иконкой «глаз».
  const PasswordField = ({
    label, value, onChange, show, onToggleShow, autoComplete, autoFocus, placeholder,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    show: boolean;
    onToggleShow: () => void;
    autoComplete: string;
    autoFocus?: boolean;
    placeholder?: string;
  }) => (
    <div>
      <label className="text-[11px] font-medium text-muted uppercase tracking-wide">{label}</label>
      <div className="relative mt-1">
        <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type={show ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2 text-[13px] bg-surface-alt border border-border-soft rounded-md focus:outline-none focus:border-accent"
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={onToggleShow}
          tabIndex={-1}
          aria-label={show ? t('Скрыть пароль', 'Hide password') : t('Показать пароль', 'Show password')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted hover:text-text hover:bg-surface"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-[400px] bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-border-soft flex items-center gap-2">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
            style={{ background: 'var(--accent)' }}
          >
            <KeyRound size={18} />
          </div>
          <div>
            <div className="font-display font-semibold text-[16px]">
              {isChange ? t('Смена пароля', 'Change password') : t('Новый пароль', 'New password')}
            </div>
            <div className="text-[12px] text-muted">
              {isChange
                ? t('Введите текущий и новый пароль', 'Enter your current and new password')
                : t('Придумайте пароль для входа', 'Set a new password for sign-in')}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3">
          {isChange && (
            <PasswordField
              label={t('Текущий пароль', 'Current password')}
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrent}
              onToggleShow={() => setShowCurrent(s => !s)}
              autoComplete="current-password"
              autoFocus
              placeholder="••••••••"
            />
          )}

          <PasswordField
            label={t('Новый пароль', 'New password')}
            value={password}
            onChange={setPassword}
            show={showNew}
            onToggleShow={() => setShowNew(s => !s)}
            autoComplete="new-password"
            autoFocus={!isChange}
            placeholder={t('минимум 6 символов', 'at least 6 characters')}
          />

          <PasswordField
            label={t('Повторите пароль', 'Confirm password')}
            value={confirm}
            onChange={setConfirm}
            show={showConfirm}
            onToggleShow={() => setShowConfirm(s => !s)}
            autoComplete="new-password"
          />

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-md text-[12px] text-red-600">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2.5 text-[13px] border border-border-soft rounded-md hover:bg-surface-alt disabled:opacity-50"
            >
              {t('Отмена', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 text-[13px] font-medium text-white rounded-md hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {t('Сохранить', 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
