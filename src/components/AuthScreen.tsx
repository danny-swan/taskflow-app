/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.9 — Экран авторизации.
 * Показывается при первом запуске или когда grace period истёк и
 * requires re-login. Email/Password + Google OAuth (заготовка).
 * Обязательный чекбокс согласия с Политикой конфиденциальности.
 */
import { useState } from 'react';
import { Sparkles, Mail, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { signInWithPassword, signUpWithPassword, signInWithGoogle } from '../lib/auth';
import { logEvent } from '../lib/telemetry';
import { useStore } from '../store/useStore';
import { PrivacyModal } from './PrivacyModal';

type Mode = 'signin' | 'signup';

interface Props {
  reason?: 'first-run' | 'grace-expired' | 'signed-out';
}

export function AuthScreen({ reason = 'first-run' }: Props) {
  const lang = useStore(s => s.language);
  const isRu = lang === 'ru';

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = (ru: string, en: string) => (isRu ? ru : en);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'signup' && !privacyAccepted) {
      setError(t('Примите Политику конфиденциальности', 'Please accept the Privacy Policy'));
      return;
    }
    if (password.length < 6) {
      setError(t('Пароль должен быть не короче 6 символов', 'Password must be at least 6 characters'));
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        await signUpWithPassword(email, password);
        await logEvent('signup');
      } else {
        await signInWithPassword(email, password);
        await logEvent('login');
      }
      // После успеха useAuth автоматически обновит состояние
    } catch (err: any) {
      setError(err?.message ?? t('Ошибка авторизации', 'Authentication error'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    if (mode === 'signup' && !privacyAccepted) {
      setError(t('Примите Политику конфиденциальности', 'Please accept the Privacy Policy'));
      return;
    }
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err?.message ?? t('Ошибка Google-логина', 'Google login error'));
      setLoading(false);
    }
  };

  const reasonText = () => {
    if (reason === 'grace-expired')
      return t(
        'Прошла неделя с последнего подключения — войдите снова для подтверждения аккаунта.',
        'It has been a week since your last connection — please sign in again to confirm your account.',
      );
    if (reason === 'signed-out') return t('Вы вышли из аккаунта.', 'You have been signed out.');
    return null;
  };

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-bg flex items-center justify-center p-4">
        <div className="w-full max-w-[400px] bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-border-soft flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
              style={{ background: 'var(--accent)' }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <div className="font-display font-semibold text-[16px]">TaskFlow</div>
              <div className="text-[12px] text-muted">
                {mode === 'signin'
                  ? t('Вход в аккаунт', 'Sign in to your account')
                  : t('Создание аккаунта', 'Create an account')}
              </div>
            </div>
          </div>

          {reasonText() && (
            <div className="px-6 pt-4 text-[12.5px] text-muted leading-relaxed">
              {reasonText()}
            </div>
          )}

          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted uppercase tracking-wide">Email</label>
              <div className="relative mt-1">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-3 py-2 text-[13px] bg-surface-alt border border-border-soft rounded-md focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted uppercase tracking-wide">
                {t('Пароль', 'Password')}
              </label>
              <div className="relative mt-1">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="password"
                  required
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? t('минимум 6 символов', 'at least 6 characters') : '••••••••'}
                  className="w-full pl-9 pr-3 py-2 text-[13px] bg-surface-alt border border-border-soft rounded-md focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            {mode === 'signup' && (
              <label className="flex items-start gap-2 text-[12px] text-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={e => setPrivacyAccepted(e.target.checked)}
                  className="mt-0.5 shrink-0"
                />
                <span className="leading-snug">
                  {t('Я принимаю ', 'I accept the ')}
                  <button
                    type="button"
                    onClick={() => setShowPrivacy(true)}
                    className="text-accent hover:underline"
                  >
                    {t('Политику конфиденциальности', 'Privacy Policy')}
                  </button>
                  {t(
                    ' и согласен на сбор базовой телеметрии (регистрация, версия приложения, статистика использования).',
                    ' and consent to basic telemetry collection (registration, app version, usage statistics).',
                  )}
                </span>
              </label>
            )}

            {error && (
              <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-md text-[12px] text-red-600">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-[13px] font-medium text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)' }}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {mode === 'signin' ? t('Войти', 'Sign in') : t('Создать аккаунт', 'Create account')}
            </button>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border-soft" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-surface px-2 text-[11px] text-muted">{t('или', 'or')}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-[13px] font-medium border border-border-soft rounded-md hover:bg-surface-alt disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09 0-.73.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              {t('Продолжить с Google', 'Continue with Google')}
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin');
                  setError(null);
                }}
                className="text-[12px] text-muted hover:text-text"
              >
                {mode === 'signin'
                  ? t('Нет аккаунта? Зарегистрироваться', "Don't have an account? Sign up")
                  : t('Уже есть аккаунт? Войти', 'Already have an account? Sign in')}
              </button>
            </div>
          </form>

          <div className="px-6 py-3 bg-surface-alt border-t border-border-soft text-[11px] text-muted text-center">
            {t(
              'TaskFlow полностью офлайн. После входа неделю можно работать без интернета.',
              'TaskFlow is fully offline. After login you can work without internet for a week.',
            )}
          </div>
        </div>
      </div>
      {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
    </>
  );
}
