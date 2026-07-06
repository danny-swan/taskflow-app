/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.35-dev.6 — Унифицированная paywall-модалка + PaywallGate обёртка.
 *
 * Задачи:
 *   1. Единая точка UX для любых Pro-only фич (Calendar, Sync, Realtime,
 *      Shared Spaces, TG-бот в будущем и т.д.).
 *   2. Не блокирует UI жёстко — юзер может закрыть модалку и вернуться на
 *      бесплатные разделы. Гейт только на самой платной странице.
 *   3. Ведёт пользователя в Settings → Подписка (там реальные кнопки
 *      trial/оплата/ручная активация — не дублируем всё в модалке).
 *
 * Компоненты:
 *   - PaywallModal   — портальная модалка (можно вызвать откуда угодно).
 *   - PaywallGate    — обёртка страницы: если free → показывает fullscreen
 *                      объяснение вместо контента. Ссылки на Settings.
 *   - PaywallBadge   — маленький бейдж «Pro» для расстановки в UI-элементах.
 *
 * Стиль: используем существующие tailwind-классы проекта
 * (bg-surface / border-border / text-muted / text-accent), чтобы модалка
 * выглядела как остальное приложение и адаптировалась к любой теме.
 */
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, ArrowRight, Clock, Check } from 'lucide-react';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import { tr, Lang } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import {
  useEntitlement,
  daysLeftInTrial,
  type Entitlement,
} from '../lib/entitlements';

// ─── i18n локально (пока не мигрируем в i18n.ts, чтобы диф был компактный) ────
// В dev.6.1 перенесём в src/lib/i18n.ts. Сейчас держим здесь ради изолированности.

type L10nKey =
  | 'paywall_title'
  | 'paywall_subtitle'
  | 'paywall_feature_calendar'
  | 'paywall_feature_sync'
  | 'paywall_feature_realtime'
  | 'paywall_feature_future'
  | 'paywall_cta_open_settings'
  | 'paywall_cta_close'
  | 'paywall_trial_active'
  | 'paywall_trial_expired'
  | 'paywall_gate_title'
  | 'paywall_gate_subtitle_free'
  | 'paywall_gate_subtitle_trial_expired';

const L10N: Record<Lang, Record<L10nKey, string>> = {
  ru: {
    paywall_title: 'Функция Pro',
    paywall_subtitle: 'Разблокируйте продвинутые возможности TaskFlow.',
    paywall_feature_calendar: 'Календарь и планировщик задач',
    paywall_feature_sync: 'Синхронизация между устройствами',
    paywall_feature_realtime: 'Обновления в реальном времени',
    paywall_feature_future: 'Совместные пространства и Telegram-бот (скоро)',
    paywall_cta_open_settings: 'Перейти в настройки подписки',
    paywall_cta_close: 'Закрыть',
    paywall_trial_active: 'Trial активен · осталось {n} дн.',
    paywall_trial_expired: 'Ваш trial закончился',
    paywall_gate_title: 'Раздел доступен на Pro',
    paywall_gate_subtitle_free:
      'Это платный раздел. Начните 14-дневный trial или активируйте Pro в настройках подписки.',
    paywall_gate_subtitle_trial_expired:
      'Ваш пробный период закончился. Оформите подписку, чтобы продолжить использование.',
  },
  en: {
    paywall_title: 'Pro feature',
    paywall_subtitle: 'Unlock advanced TaskFlow capabilities.',
    paywall_feature_calendar: 'Calendar and task planner',
    paywall_feature_sync: 'Cross-device sync',
    paywall_feature_realtime: 'Real-time updates',
    paywall_feature_future: 'Shared spaces and Telegram bot (coming soon)',
    paywall_cta_open_settings: 'Open subscription settings',
    paywall_cta_close: 'Close',
    paywall_trial_active: 'Trial active · {n} days left',
    paywall_trial_expired: 'Your trial has ended',
    paywall_gate_title: 'Pro-only section',
    paywall_gate_subtitle_free:
      'This is a paid section. Start a 14-day trial or activate Pro in subscription settings.',
    paywall_gate_subtitle_trial_expired:
      'Your trial has ended. Get a subscription to continue.',
  },
};

function loc(lang: Lang, key: L10nKey, vars?: Record<string, string | number>): string {
  let s = L10N[lang]?.[key] ?? L10N.en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace('{' + k + '}', String(v));
  return s;
}

// ─── PaywallModal ─────────────────────────────────────────────────────────────

/**
 * Универсальная paywall-модалка. Открывается когда free-юзер пытается зайти в
 * платный раздел или нажать платную кнопку. Не пытается закрыть навигацию —
 * достаточно объяснить, что это Pro, и провести в Settings.
 */
export function PaywallModal({
  open,
  onClose,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  /** Опциональный текст-объяснение, что именно юзер пытается сделать. */
  reason?: string;
}) {
  const lang = useStore(s => s.language);
  const navigate = useNavigate();
  const auth = useAuth();
  const { entitlement } = useEntitlement(auth.user?.id ?? null, auth.user?.email ?? null);

  const goToSubscription = () => {
    navigate('/settings#subscription');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={520}
      label={loc(lang, 'paywall_title')}
    >
      <div className="px-6 py-5 border-b border-border-soft flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{
            background: 'color-mix(in oklab, var(--accent, #01696F) 15%, transparent)',
          }}
        >
          <Sparkles className="w-4 h-4 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-text">
            {loc(lang, 'paywall_title')}
          </div>
          <div className="text-[12px] text-muted truncate">
            {reason ?? loc(lang, 'paywall_subtitle')}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted hover:text-text p-1 rounded"
          aria-label={loc(lang, 'paywall_cta_close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-6 py-5 space-y-3 text-[13px]">
        <TrialBanner e={entitlement} lang={lang} />

        <ul className="space-y-2">
          <FeatureLine text={loc(lang, 'paywall_feature_calendar')} />
          <FeatureLine text={loc(lang, 'paywall_feature_sync')} />
          <FeatureLine text={loc(lang, 'paywall_feature_realtime')} />
          <FeatureLine text={loc(lang, 'paywall_feature_future')} muted />
        </ul>
      </div>

      <div className="px-6 py-4 border-t border-border-soft flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-[13px] rounded-md border border-border-soft hover:bg-surface-alt"
        >
          {loc(lang, 'paywall_cta_close')}
        </button>
        <button
          onClick={goToSubscription}
          className="px-3 py-1.5 text-[13px] rounded-md text-white flex items-center gap-1.5"
          style={{ background: 'var(--accent, #01696F)' }}
        >
          {loc(lang, 'paywall_cta_open_settings')}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </Modal>
  );
}

function FeatureLine({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <Check
        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${muted ? 'text-muted' : 'text-accent'}`}
      />
      <span className={muted ? 'text-muted' : 'text-text'}>{text}</span>
    </li>
  );
}

function TrialBanner({ e, lang }: { e: Entitlement; lang: Lang }) {
  if (e.isTrialActive) {
    const days = daysLeftInTrial(e);
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-alt border border-border-soft text-[12px] text-muted">
        <Clock className="w-3.5 h-3.5 text-accent" />
        {loc(lang, 'paywall_trial_active', { n: days })}
      </div>
    );
  }
  if (e.rawPlan === 'trial' && e.effectivePlan === 'free') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-alt border border-border-soft text-[12px] text-muted">
        <Clock className="w-3.5 h-3.5" />
        {loc(lang, 'paywall_trial_expired')}
      </div>
    );
  }
  return null;
}

// ─── PaywallGate ─────────────────────────────────────────────────────────────

/**
 * Обёртка страницы: если пользователь free (или trial истёк) — показывает
 * fullscreen объяснение вместо реального контента. Если Pro/Trial/Lifetime —
 * рендерит children.
 *
 * Использование:
 *   <PaywallGate>
 *     <CalendarPage />
 *   </PaywallGate>
 *
 * Не показывает спиннер во время загрузки entitlement — стартует с кэша,
 * так что первый рендер сразу верный в 99% случаев. Если кэш пуст и юзер
 * действительно Pro — на секунду покажется «Раздел на Pro», затем refetch
 * заменит на children. Это ok для v0.9.35-dev.6.
 */
export function PaywallGate({ children }: { children: React.ReactNode }) {
  const lang = useStore(s => s.language);
  const navigate = useNavigate();
  const auth = useAuth();
  const { entitlement, loading } = useEntitlement(
    auth.user?.id ?? null,
    auth.user?.email ?? null,
  );

  // Пока auth или entitlement ещё грузятся — показываем детей, но заранее
  // отрендерить может быть плохо (например Calendar сделает fetch). Всё же
  // безопаснее показать «загрузку», а не мигать. Логика простая:
  //   auth.loading  -> ничего не показываем (App.tsx показывает splash).
  //   entitlement.loading + нет кэша -> кратковременно purchases-gate,
  //   но это редкий edge case.
  if (auth.loading) return <>{children}</>;

  // v0.9.35-dev.6: E2E bypass — тот же флаг, что в App.tsx auth-guard.
  // Playwright тесты открывают UI без авторизации через ?e2e=1 — гейт подписки тоже
  // надо байпасить, иначе тесты календаря сломаются.
  if (typeof window !== 'undefined' && window.location.search.includes('e2e=1')) {
    return <>{children}</>;
  }

  const allowed =
    entitlement.effectivePlan === 'pro' ||
    entitlement.effectivePlan === 'trial' ||
    entitlement.effectivePlan === 'lifetime';

  if (allowed) return <>{children}</>;

  // Free / trial-expired. Показываем объяснение.
  const trialExpired = entitlement.rawPlan === 'trial' && entitlement.effectivePlan === 'free';
  const subtitleKey: L10nKey = trialExpired
    ? 'paywall_gate_subtitle_trial_expired'
    : 'paywall_gate_subtitle_free';

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <div className="max-w-[440px] w-full text-center">
        <div
          className="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4"
          style={{
            background: 'color-mix(in oklab, var(--accent, #01696F) 15%, transparent)',
          }}
        >
          <Sparkles className="w-6 h-6 text-accent" />
        </div>
        <div className="text-[18px] font-semibold text-text mb-2">
          {loc(lang, 'paywall_gate_title')}
        </div>
        <div className="text-[13px] text-muted mb-5 leading-relaxed">
          {loc(lang, subtitleKey)}
        </div>
        {loading && !entitlement && (
          <div className="text-[11px] text-muted mb-3">…</div>
        )}
        <button
          onClick={() => navigate('/settings#subscription')}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] rounded-md text-white"
          style={{ background: 'var(--accent, #01696F)' }}
        >
          {loc(lang, 'paywall_cta_open_settings')}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── PaywallBadge ────────────────────────────────────────────────────────────

/** Маленький бейдж «Pro» для расстановки рядом с платными пунктами меню. */
export function PaywallBadge({ size = 'sm' }: { size?: 'sm' | 'xs' }) {
  const cls = size === 'xs' ? 'text-[9px] px-1 py-[1px]' : 'text-[10px] px-1.5 py-[1px]';
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded font-semibold ${cls}`}
      style={{
        background: 'color-mix(in oklab, var(--accent, #01696F) 15%, transparent)',
        color: 'var(--accent, #01696F)',
      }}
    >
      <Sparkles className="w-2.5 h-2.5" />
      Pro
    </span>
  );
}
