/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.9  — Экран авторизации.
 * v0.9.14 — Забыли пароль, запомнить email, верификация email при регистрации.
 *
 * Показывается при первом запуске или когда grace period истёк и
 * requires re-login. Email/Password + Google OAuth.
 * Обязательный чекбокс согласия с Политикой конфиденциальности при регистрации.
 */
import { useState } from 'react';
import { Sparkles, Mail, Lock, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  requestPasswordReset,
  getRememberedEmail,
  setRememberedEmail,
} from '../lib/auth';
import { logEvent } from '../lib/telemetry';
import { useStore } from '../store/useStore';
import { PrivacyModal } from './PrivacyModal';

type Mode = 'signin' | 'signup' | 'forgot';

interface Props {
  reason?: 'first-run' | 'grace-expired' | 'signed-out';
}

export function AuthScreen({ reason = 'first-run' }: Props) {
  const lang = useStore(s => s.language);
  const isRu = lang === 'ru';

  const [mode, setMode] = useState<Mode>('signin');
  // v0.9.14: префиллим email из localStorage, если пользователь прошлый раз поставил «Запомнить».
  const [email, setEmail] = useState(() => getRememberedEmail() ?? '');
  const [password, setPassword] = useState('');
  // v0.9.14: чекбокс «Запомнить» — определяет, сохранить ли email после входа.
  const [rememberMe, setRememberMe] = useState<boolean>(() => getRememberedEmail() !== null);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v0.9.14: success-баннер — используется для «Письмо отправлено»
  // после forgot password и после signup с verify email.
  const [notice, setNotice] = useState<string | null>(null);

  const t = (ru: string, en: string) => (isRu ? ru : en);

  // v0.9.14: применяем «rememberMe» к email перед любым входом/регистрацией.
  const persistEmailIfNeeded = () => {
    setRememberedEmail(rememberMe ? email : null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // v0.9.14: forgot-ветка — отдельный flow без пароля.
    if (mode === 'forgot') {
      if (!email) {
        setError(t('Введите email', 'Enter your email'));
        return;
      }
      setLoading(true);
      try {
        await requestPasswordReset(email);
        setNotice(t(
          'Письмо со ссылкой отправлено. Проверьте почту и перейдите по ссылке — приложение откроет экран ввода нового пароля.',
          'A reset link has been sent. Check your inbox and follow the link — the app will open a screen to set a new password.',
        ));
        persistEmailIfNeeded();
      } catch (err: any) {
        setError(err?.message ?? t('Не удалось отправить письмо', 'Failed to send reset email'));
      } finally {
        setLoading(false);
      }
      return;
    }

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
        persistEmailIfNeeded();
        // v0.9.14: если в Supabase включена верификация email, сессии ещё нет —
        // показываем сообщение «проверьте email».
        setNotice(t(
          'Аккаунт создан. Проверьте почту и подтвердите email по ссылке, чтобы войти.',
          'Account created. Check your inbox and confirm your email via the link to sign in.',
        ));
      } else {
        await signInWithPassword(email, password);
        await logEvent('login');
        persistEmailIfNeeded();
      }
      // После успеха useAuth автоматически обновит состояние (если сессия есть)
    } catch (err: any) {
      setError(err?.message ?? t('Ошибка авторизации', 'Authentication error'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setNotice(null);
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
                {mode === 'signin' && t('Вход в аккаунт', 'Sign in to your account')}
                {mode === 'signup' && t('Создание аккаунта', 'Create an account')}
                {mode === 'forgot' && t('Восстановление пароля', 'Reset your password')}
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

            {mode !== 'forgot' && (
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
            )}

            {/* v0.9.14: «Запомнить меня» — доступен и для входа, и для регистрации. */}
            {mode !== 'forgot' && (
              <label className="flex items-center gap-2 text-[12px] text-text cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="shrink-0"
                />
                <span>{t('Запомнить меня на этом устройстве', 'Remember me on this device')}</span>
              </label>
            )}

            {/* v0.9.14: ссылка «Забыли пароль?» — только в режиме входа. */}
            {mode === 'signin' && (
              <div className="flex justify-end -mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setError(null);
                    setNotice(null);
                  }}
                  className="text-[12px] text-accent hover:underline"
                >
                  {t('Забыли пароль?', 'Forgot password?')}
                </button>
              </div>
            )}

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

            {/* v0.9.14: notice-баннер — «письмо отправлено» и «подтвердите email». */}
            {notice && (
              <div className="flex items-start gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-md text-[12px] text-green-700">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                <span className="leading-snug">{notice}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-[13px] font-medium text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)' }}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {mode === 'signin' && t('Войти', 'Sign in')}
              {mode === 'signup' && t('Создать аккаунт', 'Create account')}
              {mode === 'forgot' && t('Отправить ссылку', 'Send reset link')}
            </button>

            {/* v0.9.14: Google-кнопка скрыта в режиме forgot — там нужен именно email. */}
            {mode !== 'forgot' && (
              <>
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
              </>
            )}

            <div className="text-center pt-1">
              {mode === 'forgot' ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setError(null);
                    setNotice(null);
                  }}
                  className="text-[12px] text-muted hover:text-text"
                >
                  {t('← Назад ко входу', '← Back to sign in')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === 'signin' ? 'signup' : 'signin');
                    setError(null);
                    setNotice(null);
                  }}
                  className="text-[12px] text-muted hover:text-text"
                >
                  {mode === 'signin'
                    ? t('Нет аккаунта? Зарегистрироваться', "Don't have an account? Sign up")
                    : t('Уже есть аккаунт? Войти', 'Already have an account? Sign in')}
                </button>
              )}
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
