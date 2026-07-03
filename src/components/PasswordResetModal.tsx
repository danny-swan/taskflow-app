/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.14 — Модалка ввода нового пароля.
 *
 * Показывается после recovery deep-link из письма Supabase. К этому моменту
 * сессия уже установлена (handleAuthCallback вызвал setSession), поэтому
 * updatePassword() выполняется под этой временной сессией и заменяет пароль
 * пользователя.
 *
 * После успеха сессия остаётся — пользователь сразу попадает в приложение.
 */
import { useState } from 'react';
import { Lock, AlertCircle, Loader2, KeyRound } from 'lucide-react';
import { updatePassword } from '../lib/auth';
import { useStore } from '../store/useStore';

interface Props {
  onClose: () => void;
}

export function PasswordResetModal({ onClose }: Props) {
  const lang = useStore(s => s.language);
  const pushToast = useStore(s => s.pushToast);
  const isRu = lang === 'ru';
  const t = (ru: string, en: string) => (isRu ? ru : en);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError(t('Пароль должен быть не короче 6 символов', 'Password must be at least 6 characters'));
      return;
    }
    if (password !== confirm) {
      setError(t('Пароли не совпадают', 'Passwords do not match'));
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      pushToast(t('Пароль обновлён', 'Password updated'));
      onClose();
    } catch (err: any) {
      setError(err?.message ?? t('Ошибка смены пароля', 'Password change failed'));
    } finally {
      setLoading(false);
    }
  };

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
              {t('Новый пароль', 'New password')}
            </div>
            <div className="text-[12px] text-muted">
              {t('Придумайте пароль для входа', 'Set a new password for sign-in')}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3">
          <div>
            <label className="text-[11px] font-medium text-muted uppercase tracking-wide">
              {t('Новый пароль', 'New password')}
            </label>
            <div className="relative mt-1">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('минимум 6 символов', 'at least 6 characters')}
                className="w-full pl-9 pr-3 py-2 text-[13px] bg-surface-alt border border-border-soft rounded-md focus:outline-none focus:border-accent"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted uppercase tracking-wide">
              {t('Повторите пароль', 'Confirm password')}
            </label>
            <div className="relative mt-1">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-[13px] bg-surface-alt border border-border-soft rounded-md focus:outline-none focus:border-accent"
              />
            </div>
          </div>

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
