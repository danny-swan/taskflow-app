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
 *   - mode="change" — обычная смена пароля из Settings.
 *   + иконка «глаз» для всех password-полей.
 *
 * v0.9.25 — попытка исправить 3 бага: hoisted PasswordField, shared validation,
 *   ephemeral verify. Первые два сработали, а ephemeral verify — нет: после
 *   активации Turnstile Secret Key в Supabase Attack Protection любой
 *   signInWithPassword требует captchaToken, которого в модалке нет.
 *   Поэтому проверка всегда возвращала false → «Неверный текущий пароль».
 *
 * v0.9.26 — Убрали ввод текущего пароля и всю reauth-логику.
 *
 *   Логика: пользователь и так авторизован (модалка открывается только из
 *   Settings), Supabase выпускает updatePassword под активной сессией.
 *   Дополнительная защита (Reauthentication AAL / Secure Password Change)
 *   при желании включается в дашборде Supabase — клиент подхватит её без
 *   изменений в коде.
 *
 *   Плюсы: (а) нет виджета Turnstile в модалке, (б) нет ephemeral client,
 *   (в) один input меньше, (г) поведение согласуется с большинством
 *   современных приложений (Google/GitHub требуют текущий пароль только
 *   для критичных операций вроде 2FA / смены email).
 *
 *   mode='change' и mode='reset' теперь ведут себя одинаково — оба просто
 *   спрашивают новый пароль + подтверждение. Пропс сохранён для обратной
 *   совместимости с App.tsx (recovery deep-link).
 */
import { useState } from 'react';
import { Lock, AlertCircle, Loader2, KeyRound, Eye, EyeOff } from 'lucide-react';
import { updatePassword } from '../lib/auth';
import { validatePasswordStrength, passwordHint } from '../lib/password';
import { useStore } from '../store/useStore';

interface Props {
  onClose: () => void;
  /** default 'reset'. v0.9.26: поведение одинаковое для обоих режимов, флаг оставлен для API-совместимости. */
  mode?: 'reset' | 'change';
  /** v0.9.26: больше не используется — оставлен для совместимости с существующими вызовами. */
  userEmail?: string;
}

// v0.9.25: PasswordField ВНЕ тела PasswordResetModal — иначе React пересоздаёт
// функцию на каждом setState и размонтирует input-ы, теряя autoFocus и каретку.
function PasswordField({
  label, value, onChange, show, onToggleShow, autoComplete, autoFocus, placeholder, ruLang,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete: string;
  autoFocus?: boolean;
  placeholder?: string;
  ruLang: boolean;
}) {
  return (
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
          aria-label={
            show
              ? (ruLang ? 'Скрыть пароль' : 'Hide password')
              : (ruLang ? 'Показать пароль' : 'Show password')
          }
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted hover:text-text hover:bg-surface"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function PasswordResetModal({ onClose, mode = 'reset', userEmail: _userEmail }: Props) {
  const lang = useStore(s => s.language);
  const pushToast = useStore(s => s.pushToast);
  const isRu = lang === 'ru';
  const t = (ru: string, en: string) => (isRu ? ru : en);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const isChange = mode === 'change';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // v0.9.25: полная проверка правил Supabase — 8 + Aa + digit.
    const strengthError = validatePasswordStrength(password, isRu);
    if (strengthError) {
      setError(strengthError);
      return;
    }
    if (password !== confirm) {
      setError(t('Пароли не совпадают', 'Passwords do not match'));
      return;
    }

    setLoading(true);
    try {
      // v0.9.26: updatePassword под активной сессией. Дополнительная защита
      // (Reauthentication AAL) при необходимости включается на стороне
      // Supabase — клиент подхватит её без изменений.
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
              {isChange ? t('Смена пароля', 'Change password') : t('Новый пароль', 'New password')}
            </div>
            <div className="text-[12px] text-muted">
              {isChange
                ? t('Введите новый пароль', 'Enter a new password')
                : t('Придумайте пароль для входа', 'Set a new password for sign-in')}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3">
          <PasswordField
            label={t('Новый пароль', 'New password')}
            value={password}
            onChange={setPassword}
            show={showNew}
            onToggleShow={() => setShowNew(s => !s)}
            autoComplete="new-password"
            autoFocus
            placeholder={passwordHint(isRu)}
            ruLang={isRu}
          />

          <PasswordField
            label={t('Повторите пароль', 'Confirm password')}
            value={confirm}
            onChange={setConfirm}
            show={showConfirm}
            onToggleShow={() => setShowConfirm(s => !s)}
            autoComplete="new-password"
            ruLang={isRu}
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
