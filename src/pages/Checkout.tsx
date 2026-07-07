/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.35-dev.6.5.1 — страница /checkout:
 *   • обычный режим: три тарифа TaskFlow Pro (?tier=monthly|annual|lifetime).
 *   • режим update-card (?mode=update-card): пробный платёж 1₽ для сохранения
 *     нового способа оплаты. После успешного платежа webhook сохраняет карту
 *     в payment_methods и автоматически возвращает 1₽. Entitlement не меняется.
 *
 * Flow (purchase):
 *   1. Пользователь выбирает тариф (monthly / annual / lifetime).
 *   2. Клик → вызов Edge Function `create-payment` (передаём tier).
 *   3. Функция возвращает confirmation_url ЮKassa.
 *   4. Открываем URL в системном браузере (tauri-plugin-shell).
 *   5. После оплаты юзер вернётся на yourtaskflow.app/pay/success —
 *      там на лендинге есть deep-link `taskflow://pay/success?tier=...` обратно
 *      в приложение. Активация entitlement идёт через webhook (см.
 *      supabase/functions/payment-webhook), поэтому пользователь просто
 *      обновляет страницу подписки — данные подтянутся через realtime-sync.
 *
 * Flow (update-card):
 *   1. Пользователь заходит на /checkout?mode=update-card (из Settings).
 *   2. Показывается отдельный экран «Обновить способ оплаты» (1₽ + возврат).
 *   3. Клик → create-payment с { mode: 'update-card' }.
 *   4. ЮKassa: списание 1₽ с сохранением способа оплаты.
 *   5. webhook: сохранение payment_method + автоматический refund 1₽.
 *   6. Через realtime новая карта появляется в Settings → Управление подпиской.
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useEntitlement } from '../lib/entitlements';
import { Check, Loader2, ExternalLink, CreditCard, ShieldCheck } from 'lucide-react';

interface Tier {
  id: 'monthly' | 'annual' | 'lifetime';
  labelRu: string;
  labelEn: string;
  priceRu: string;
  priceEn: string;
  periodRu: string;
  periodEn: string;
  descriptionRu: string;
  descriptionEn: string;
  highlight?: boolean;
}

const TIERS: Tier[] = [
  {
    id: 'monthly',
    labelRu: 'Ежемесячно',
    labelEn: 'Monthly',
    priceRu: '299 ₽',
    priceEn: '299 ₽',
    periodRu: 'в месяц',
    periodEn: 'per month',
    descriptionRu: 'Полный доступ ко всем функциям. Отмена в любой момент.',
    descriptionEn: 'Full access to all features. Cancel anytime.',
  },
  {
    id: 'annual',
    labelRu: 'Ежегодно',
    labelEn: 'Annual',
    priceRu: '2 990 ₽',
    priceEn: '2 990 ₽',
    periodRu: 'в год · экономия 17%',
    periodEn: 'per year · save 17%',
    descriptionRu: 'Один платёж на год. Наш самый популярный тариф.',
    descriptionEn: 'One payment for a year. Our most popular tier.',
    highlight: true,
  },
  {
    id: 'lifetime',
    labelRu: 'Пожизненно',
    labelEn: 'Lifetime',
    priceRu: '4 990 ₽',
    priceEn: '4 990 ₽',
    periodRu: 'единоразово · навсегда',
    periodEn: 'one-time · forever',
    descriptionRu: 'Один платёж — все будущие обновления входят.',
    descriptionEn: 'One payment — all future updates included.',
  },
];

const FEATURES_RU = [
  'Синхронизация между устройствами',
  'Календарь и планирование',
  'Расширенная статистика',
  'Приоритет в поддержке',
  'Все будущие фичи Pro',
];
const FEATURES_EN = [
  'Cross-device sync',
  'Calendar and planning',
  'Advanced statistics',
  'Priority support',
  'All future Pro features',
];

export function CheckoutPage() {
  const lang = useStore(s => s.language);
  const isRu = lang === 'ru';
  const t = (ru: string, en: string) => (isRu ? ru : en);
  const pushToast = useStore(s => s.pushToast);

  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const userEmail = auth.user?.email ?? null;
  const { entitlement } = useEntitlement(userId, userEmail);

  const [loadingTier, setLoadingTier] = useState<Tier['id'] | null>(null);
  const [updateCardBusy, setUpdateCardBusy] = useState(false);

  // v0.9.35-dev.6.4: если пришли через ?tier= (с лендинга через deep-link
  // или из SubscriptionBlock) — подсвечиваем карточку и скроллим к ней.
  // v0.9.35-dev.6.5.1: если пришли через ?mode=update-card — показываем
  // отдельный экран обновления карты (1₽ + автоматический возврат).
  const [searchParams] = useSearchParams();
  const isUpdateCardMode = searchParams.get('mode') === 'update-card';
  const preselectedTier = searchParams.get('tier');
  const validPreselected: Tier['id'] | null =
    preselectedTier === 'monthly' || preselectedTier === 'annual' || preselectedTier === 'lifetime'
      ? preselectedTier
      : null;
  const tierRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (validPreselected && tierRefs.current[validPreselected]) {
      tierRefs.current[validPreselected]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [validPreselected]);

  async function openConfirmationUrl(url: string) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  async function handleBuy(tier: Tier) {
    if (!auth.user) {
      pushToast(t('Войдите в аккаунт для оплаты', 'Sign in to purchase'));
      return;
    }
    setLoadingTier(tier.id);
    try {
      const { data, error } = await supabase.functions.invoke('create-payment', {
        body: { tier: tier.id },
      });
      if (error) throw error;
      if (!data?.confirmation_url) {
        throw new Error(data?.error ?? 'No confirmation_url from server');
      }
      await openConfirmationUrl(data.confirmation_url);
      pushToast(
        t(
          'Открыто окно оплаты в браузере. После оплаты подписка активируется автоматически.',
          'Payment page opened in browser. Your subscription will activate automatically after payment.',
        ),
      );
    } catch (e) {
      const msg = (e as Error).message ?? 'Unknown error';
      pushToast(t(`Ошибка: ${msg}`, `Error: ${msg}`));
    } finally {
      setLoadingTier(null);
    }
  }

  async function handleUpdateCard() {
    if (!auth.user) {
      pushToast(t('Войдите в аккаунт', 'Sign in first'));
      return;
    }
    setUpdateCardBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-payment', {
        body: { mode: 'update-card' },
      });
      if (error) throw error;
      if (!data?.confirmation_url) {
        throw new Error(data?.error ?? 'No confirmation_url from server');
      }
      await openConfirmationUrl(data.confirmation_url);
      pushToast(
        t(
          'Открыто окно ЮKassa. После оплаты 1₽ карта сохранится и деньги вернутся автоматически.',
          'ЮKassa opened. After the ₽1 charge, your card will be saved and refunded automatically.',
        ),
      );
    } catch (e) {
      const msg = (e as Error).message ?? 'Unknown error';
      pushToast(t(`Ошибка: ${msg}`, `Error: ${msg}`));
    } finally {
      setUpdateCardBusy(false);
    }
  }

  const currentPlan = entitlement?.effectivePlan ?? 'free';
  const hasLifetime = currentPlan === 'lifetime';

  // ─── Режим update-card: отдельный экран, тарифы не показываем ─────────────
  if (isUpdateCardMode) {
    return (
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
            <CreditCard className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-[26px] font-semibold mb-2">
            {t('Обновить способ оплаты', 'Update payment method')}
          </h1>
          <p className="text-muted text-[14px] max-w-xl mx-auto">
            {t(
              'Чтобы сохранить новую карту, мы спишем 1 ₽ через ЮKassa и вернём эти деньги автоматически в течение нескольких минут. Никаких скрытых списаний.',
              'To save a new card, we charge ₽1 via ЮKassa and refund it automatically within a few minutes. No hidden charges.',
            )}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 mb-6">
          <h2 className="text-[15px] font-semibold mb-4">
            {t('Что произойдёт', 'What happens')}
          </h2>
          <ol className="space-y-3 text-[14px]">
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[12px] font-medium">1</span>
              <span>{t('Открывается защищённая страница ЮKassa.', 'Secure ЮKassa page opens.')}</span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[12px] font-medium">2</span>
              <span>{t('Списывается 1 ₽ с новой карты. Карта сохраняется для будущих автосписаний.', '₽1 is charged to the new card. The card is saved for future auto-renewals.')}</span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[12px] font-medium">3</span>
              <span>{t('Мы автоматически возвращаем 1 ₽ — деньги придут обратно в течение нескольких минут (иногда до нескольких банковских дней).', 'We refund ₽1 automatically — money returns within a few minutes (sometimes up to a few banking days).')}</span>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[12px] font-medium">4</span>
              <span>{t('Новая карта появляется в разделе «Управление подпиской» → следующее автосписание пройдёт с неё.', 'The new card appears under “Subscription management” → next auto-renewal will use it.')}</span>
            </li>
          </ol>
        </div>

        <button
          onClick={handleUpdateCard}
          disabled={updateCardBusy || !auth.user}
          className="w-full py-3 rounded-lg bg-primary text-white text-[14px] font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {updateCardBusy ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('Открываем оплату…', 'Opening checkout…')}
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              {t('Продолжить в ЮKassa (1 ₽)', 'Continue to ЮKassa (₽1)')}
              <ExternalLink className="w-4 h-4" />
            </span>
          )}
        </button>

        <div className="mt-6 flex items-start gap-2 text-[12px] text-muted">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-success" />
          <p>
            {t(
              'Оплата защищена ЮKassa. Данные карты обрабатываются ЮKassa по стандарту PCI DSS — TaskFlow не хранит номера карт.',
              'Payments processed by ЮKassa (PCI DSS compliant). TaskFlow never stores card numbers.',
            )}
          </p>
        </div>

        <div className="mt-6 text-[12px] text-muted text-center">
          <a
            href="/settings"
            className="text-primary hover:underline"
          >
            {t('← Вернуться в настройки', '← Back to settings')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-[28px] font-semibold mb-2">
          {t('Оформить подписку', 'Choose your plan')}
        </h1>
        <p className="text-muted text-[14px] max-w-xl mx-auto">
          {t(
            'Выберите тариф ниже. После клика вы перейдёте на защищённую страницу оплаты ЮKassa.',
            'Choose a tier below. You will be redirected to the secure ЮKassa payment page.',
          )}
        </p>
        {hasLifetime && (
          <div className="mt-4 inline-block px-4 py-2 rounded-lg bg-success/10 border border-success/30 text-success text-[13px]">
            {t(
              'У вас уже есть Lifetime — новых покупок не требуется.',
              'You already have Lifetime — no new purchase needed.',
            )}
          </div>
        )}
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        {TIERS.map((tier) => {
          const isPreselected = validPreselected === tier.id;
          return (
          <div
            key={tier.id}
            ref={(el) => { tierRefs.current[tier.id] = el; }}
            className={
              'relative rounded-xl border p-6 flex flex-col transition-all ' +
              (isPreselected
                ? 'border-primary bg-primary/[0.06] ring-2 ring-primary/30 shadow-lg'
                : tier.highlight
                  ? 'border-primary/50 bg-primary/[0.03]'
                  : 'border-border bg-surface')
            }
          >
            {tier.highlight && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary text-white text-[11px] font-medium">
                {t('Популярное', 'Most popular')}
              </div>
            )}
            <div className="text-[14px] text-muted uppercase tracking-wide mb-2">
              {isRu ? tier.labelRu : tier.labelEn}
            </div>
            <div className="text-[32px] font-semibold mb-1">
              {isRu ? tier.priceRu : tier.priceEn}
            </div>
            <div className="text-[13px] text-muted mb-4">
              {isRu ? tier.periodRu : tier.periodEn}
            </div>
            <p className="text-[13px] text-muted mb-6 flex-1">
              {isRu ? tier.descriptionRu : tier.descriptionEn}
            </p>
            <button
              onClick={() => handleBuy(tier)}
              disabled={loadingTier !== null || hasLifetime}
              className={
                'w-full py-2.5 rounded-lg text-[14px] font-medium transition ' +
                (tier.highlight
                  ? 'bg-primary text-white hover:bg-primary/90'
                  : 'bg-surface-alt border border-border hover:border-primary/50') +
                ' disabled:opacity-50 disabled:cursor-not-allowed'
              }
            >
              {loadingTier === tier.id ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('Открываем оплату…', 'Opening checkout…')}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  {t('Оплатить', 'Buy now')}
                  <ExternalLink className="w-4 h-4" />
                </span>
              )}
            </button>
          </div>
          );
        })}
      </div>

      {/* Features list */}
      <div className="border-t border-border pt-8">
        <h2 className="text-[16px] font-semibold mb-4 text-center">
          {t('Что входит в любой Pro-тариф', 'Included in every Pro tier')}
        </h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 max-w-2xl mx-auto text-[14px]">
          {(isRu ? FEATURES_RU : FEATURES_EN).map((f, i) => (
            <li key={i} className="flex items-center gap-2">
              <Check className="w-4 h-4 text-primary shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Legal + FAQ */}
      <div className="mt-10 pt-6 border-t border-border text-[12px] text-muted text-center space-y-2">
        <p>
          {t(
            'Оплата защищена ЮKassa. Мы принимаем банковские карты, СБП, ЮMoney.',
            'Payments processed by ЮKassa. Cards, SBP, ЮMoney accepted.',
          )}
        </p>
        <p>
          {t('Совершая покупку, вы принимаете ', 'By purchasing you accept ')}
          <a
            href="https://yourtaskflow.app/legal/offer.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t('Оферту', 'the Offer')}
          </a>
          {t(', ', ', ')}
          <a
            href="https://yourtaskflow.app/legal/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t('Политику конфиденциальности', 'Privacy Policy')}
          </a>
          {t(' и ', ' and ')}
          <a
            href="https://yourtaskflow.app/legal/return.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t('Политику возврата', 'Refund Policy')}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
