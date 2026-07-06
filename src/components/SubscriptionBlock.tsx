import { useNavigate } from 'react-router-dom';
import { Sparkles, Check, ArrowRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../lib/auth';
import { useEntitlement } from '../lib/entitlements';
import { tr } from '../lib/i18n';

/**
 * v0.9.35-dev.6.4: SubscriptionBlock — рекламный блок Pro-подписки в разделе
 * «Помощь». Отделён от SupportBlock (чаевые/крипта): здесь именно продукт-подписка
 * через ЮKassa, там — благодарность разработчику.
 *
 * Показывается только пользователям на free/trial. Уже оплатившим Pro/Lifetime —
 * блок не нужен (не мешаем).
 *
 * Кнопки CTA ведут на внутренний /checkout?tier={monthly|annual|lifetime}.
 */

type Tier = 'monthly' | 'annual' | 'lifetime';

interface PlanCard {
  tier: Tier;
  labelKey: 'subscription_block_plan_monthly' | 'subscription_block_plan_annual' | 'subscription_block_plan_lifetime';
  priceKey: 'subscription_block_price_monthly' | 'subscription_block_price_annual' | 'subscription_block_price_lifetime';
  highlight: boolean;
}

const PLANS: PlanCard[] = [
  { tier: 'monthly',  labelKey: 'subscription_block_plan_monthly',  priceKey: 'subscription_block_price_monthly',  highlight: false },
  { tier: 'annual',   labelKey: 'subscription_block_plan_annual',   priceKey: 'subscription_block_price_annual',   highlight: true  },
  { tier: 'lifetime', labelKey: 'subscription_block_plan_lifetime', priceKey: 'subscription_block_price_lifetime', highlight: false },
];

export function SubscriptionBlock() {
  const lang = useStore(s => s.language);
  const navigate = useNavigate();
  const auth = useAuth();

  const user = auth.session?.user;
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  const { entitlement } = useEntitlement(userId, userEmail);

  // Показываем блок только на free/trial. Активным Pro/Lifetime — не мешаем.
  const plan = entitlement?.effectivePlan ?? 'free';
  if (plan !== 'free' && plan !== 'trial') return null;
  // Админам (override lifetime) тоже нет смысла — уже отсеклись через plan.

  const descKey = plan === 'trial' ? 'subscription_block_desc_trial' : 'subscription_block_desc_free';

  const handleClick = (tier: Tier) => {
    navigate(`/checkout?tier=${tier}`);
  };

  // Разбиваем support_block_note: «...по условиям [оферты].» → до/линк/после
  const noteRaw = tr(lang, 'subscription_block_note');
  const noteMatch = noteRaw.match(/^(.*)\[([^\]]+)\](.*)$/);
  const noteBefore = noteMatch ? noteMatch[1] : noteRaw;
  const noteLink   = noteMatch ? noteMatch[2] : '';
  const noteAfter  = noteMatch ? noteMatch[3] : '';

  return (
    <aside className="bg-surface border border-border-soft rounded-lg p-4 text-[13px] mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={16} className="text-accent shrink-0" />
        <h3 className="font-display text-[15px] font-semibold">
          {tr(lang, 'subscription_block_title')}
        </h3>
      </div>

      <p className="text-muted leading-relaxed mb-3">
        {tr(lang, descKey)}
      </p>

      <div className="space-y-2 mb-3">
        {PLANS.map(p => {
          const label = tr(lang, p.labelKey);
          const price = tr(lang, p.priceKey);

          return (
            <button
              key={p.tier}
              type="button"
              onClick={() => handleClick(p.tier)}
              className={
                'w-full flex items-center gap-2 px-3 py-2.5 rounded-md border text-left transition-colors ' +
                (p.highlight
                  ? 'bg-accent/10 border-accent/40 hover:bg-accent/15'
                  : 'bg-surface-alt/60 border-border-soft/60 hover:bg-surface-alt/80')
              }
              aria-label={`${label} — ${price}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium">{label}</span>
                  {p.highlight && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-white font-medium leading-none">
                      {tr(lang, 'subscription_block_badge_best')}
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-muted mt-0.5">{price}</div>
              </div>
              {p.highlight ? (
                <Check size={14} className="text-accent shrink-0" />
              ) : (
                <ArrowRight size={14} className="text-muted shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => navigate('/checkout')}
        className="w-full px-3 py-2 rounded-md bg-accent text-white text-[13px] font-medium hover:bg-accent/90 transition-colors flex items-center justify-center gap-1.5"
      >
        {tr(lang, 'subscription_block_cta')}
        <ArrowRight size={14} />
      </button>

      <p className="mt-3 text-[11px] text-muted leading-relaxed">
        {noteBefore}
        {noteMatch && (
          <>
            <a
              href="https://yourtaskflow.app/legal/offer.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {noteLink}
            </a>
            {noteAfter}
          </>
        )}
      </p>
    </aside>
  );
}
