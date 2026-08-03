// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.6 — AdminPage
//
// Страница ручного управления entitlements. Доступна только администраторам
// (проверяется через isAdmin из useEntitlement).
//
// Функции:
//   — Список всех пользователей с планами
//   — Установка плана (set-plan)
//   — Продление на N дней (extend)
//   — Мягкая отмена (cancel)
//   — История renewal_attempts_log по пользователю
//   — История payment_events по пользователю

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, RefreshCw, ChevronDown, ChevronRight, Check, X,
  Clock, CreditCard, AlertTriangle, Search, UserCog, Calendar,
  Ban, Plus, Loader,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../lib/auth';
import { useEntitlement } from '../lib/entitlements';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  public_user_id: string | null;
  email: string;
  registered_at: string | null;
  last_sign_in_at: string | null;
  entitlement: EntRow | null;
}

interface EntRow {
  plan: string;
  valid_until: string | null;
  auto_renew: boolean | null;
  cancel_at_period_end: boolean | null;
  source: string | null;
  notes: string | null;
  updated_at: string;
  renewal_attempts_count: number | null;
  last_payment_at: string | null;
}

// Плоская строка, возвращаемая RPC public.get_admin_users_summary() (миграция 0039).
// entitlement-поля nullable: у free-юзеров без строки в user_entitlements они NULL.
interface AdminUserSummaryRow {
  id: string;
  public_user_id: string | null;
  email: string;
  registered_at: string | null;
  last_sign_in_at: string | null;
  plan: string | null;
  valid_until: string | null;
  auto_renew: boolean | null;
  cancel_at_period_end: boolean | null;
  source: string | null;
  notes: string | null;
  ent_updated_at: string | null;
  renewal_attempts_count: number | null;
  last_payment_at: string | null;
  sessions_count: number | null;
  tasks_created_count: number | null;
  latest_app_version: string | null;
  latest_os: string | null;
}

// Чистый маппинг RPC-строки → UserRow. entitlement=null, когда у юзера нет
// строки в user_entitlements (free-план) — тогда plan приходит NULL.
export function mapAdminUserRow(row: AdminUserSummaryRow): UserRow {
  const entitlement: EntRow | null =
    row.plan == null
      ? null
      : {
          plan: row.plan,
          valid_until: row.valid_until,
          auto_renew: row.auto_renew,
          cancel_at_period_end: row.cancel_at_period_end,
          source: row.source,
          notes: row.notes,
          updated_at: row.ent_updated_at ?? row.registered_at ?? '',
          renewal_attempts_count: row.renewal_attempts_count,
          last_payment_at: row.last_payment_at,
        };
  return {
    id: row.id,
    public_user_id: row.public_user_id,
    email: row.email,
    registered_at: row.registered_at,
    last_sign_in_at: row.last_sign_in_at,
    entitlement,
  };
}

interface RenewalAttempt {
  id: string;
  attempt_number: number;
  status: string;
  yookassa_payment_id: string | null;
  error_code: string | null;
  error_message: string | null;
  attempted_at: string;
}

interface PaymentEvent {
  id: string;
  external_id: string;
  event_type: string;
  created_at: string;
}

// ─── Вспомогательные ──────────────────────────────────────────────────────────

function planBadge(plan: string): { label: string; color: string } {
  switch (plan) {
    case 'lifetime': return { label: 'Lifetime', color: '#01696F' };
    case 'pro':      return { label: 'Pro',       color: '#006494' };
    case 'trial':    return { label: 'Trial',     color: '#DA7101' };
    default:         return { label: 'Free',      color: '#7A7974' };
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const SUPABASE_URL = (import.meta as unknown as { env?: Record<string, string | undefined> })
  .env?.VITE_SUPABASE_URL ?? '';

async function callAdminAction(
  jwt: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  const fnUrl = `${SUPABASE_URL.replace('/rest/v1', '')}/functions/v1/admin-actions`;
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── Компонент ────────────────────────────────────────────────────────────────

export function AdminPage() {
  const lang = useStore(s => s.language);
  const isRu = lang === 'ru';
  // useCallback чтобы t не пересоздавалась на каждом рендере и не инвалидировала loadUsers useCallback
  const isRuRef = useRef(isRu);
  isRuRef.current = isRu;
  const t = useCallback((ru: string, en: string) => (isRuRef.current ? ru : en), []);
  const pushToast = useStore(s => s.pushToast);
  const navigate = useNavigate();
  const auth = useAuth();

  const user = auth.session?.user;
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  const { entitlement, loading: entLoading } = useEntitlement(userId, userEmail);

  // Guard — только для admin.
  // Ждём пока загрузится auth + entitlement, чтобы не было ложного redirect
  // пока resolveEntitlement ещё не получила данные из БД.
  useEffect(() => {
    if (!auth.loading && !entLoading && user && !entitlement.isAdmin) {
      navigate('/', { replace: true });
    }
  }, [auth.loading, entLoading, user, entitlement.isAdmin, navigate]);

  const [users, setUsers]           = useState<UserRow[]>([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Детали по раскрытому пользователю
  const [attempts, setAttempts]     = useState<RenewalAttempt[]>([]);
  const [events, setEvents]         = useState<PaymentEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Модалка управления
  const [modalUserId, setModalUserId]   = useState<string | null>(null);
  const [modalAction, setModalAction]   = useState<'set-plan' | 'extend' | 'cancel' | null>(null);

  // Поля модалки
  const [modalPlan, setModalPlan]       = useState<string>('pro');
  const [modalDays, setModalDays]       = useState<string>('30');
  const [modalValidUntil, setModalValidUntil] = useState<string>('');
  const [modalNotes, setModalNotes]     = useState<string>('');
  const [modalBusy, setModalBusy]       = useState(false);

  // ─── Загрузка пользователей ────────────────────────────────────────────────

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      // Один вызов admin-only SECURITY DEFINER RPC (миграция 0039): полный список
      // пользователей из profiles (+ email/public_user_id/телеметрия/entitlement).
      // Заменяет прежнюю связку user_entitlements + get_users_emails, из-за которой
      // free-юзеры без строки entitlement были невидимы в админке (баг P4/F12).
      const { data, error } = await supabase.rpc('get_admin_users_summary');
      if (error) throw error;

      const rows: UserRow[] = Array.isArray(data)
        ? (data as AdminUserSummaryRow[]).map(mapAdminUserRow)
        : [];

      setUsers(rows);
    } catch (e: unknown) {
      const msg = e instanceof Error
        ? e.message
        : (typeof e === 'object' && e !== null && 'message' in e)
          ? String((e as { message: unknown }).message)
          : String(e);
      logger.warn('[AdminPage] loadUsers error:', e);
      pushToast(t('Ошибка загрузки: ', 'Load error: ') + msg);
    } finally {
      setLoading(false);
    }
  }, [pushToast, t]);

  useEffect(() => {
    if (entitlement.isAdmin) void loadUsers();
  }, [entitlement.isAdmin, loadUsers]);

  // ─── Загрузка деталей по пользователю ─────────────────────────────────────

  const loadDetails = useCallback(async (uid: string) => {
    setDetailLoading(true);
    try {
      const [attRes, evtRes] = await Promise.all([
        supabase
          .from('renewal_attempts_log')
          .select('id, attempt_number, status, yookassa_payment_id, error_code, error_message, attempted_at')
          .eq('user_id', uid)
          .order('attempted_at', { ascending: false })
          .limit(20),
        supabase
          .from('payment_events')
          .select('id, external_id, event_type, created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      setAttempts((attRes.data ?? []) as RenewalAttempt[]);
      setEvents((evtRes.data ?? []) as PaymentEvent[]);
    } catch (e: unknown) {
      logger.warn('[AdminPage] loadDetails:', e);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleExpand = (uid: string) => {
    if (expandedId === uid) {
      setExpandedId(null);
    } else {
      setExpandedId(uid);
      void loadDetails(uid);
    }
  };

  // ─── Выполнение действия ───────────────────────────────────────────────────

  const handleModalConfirm = async () => {
    if (!modalUserId || !modalAction) return;
    const jwt = auth.session?.access_token;
    if (!jwt) { pushToast('No JWT'); return; }

    setModalBusy(true);
    try {
      let body: Record<string, unknown> = { action: modalAction, target_user_id: modalUserId };

      if (modalAction === 'set-plan') {
        body.plan = modalPlan;
        if (modalPlan === 'pro' || modalPlan === 'trial') {
          body.valid_until = modalValidUntil ? new Date(modalValidUntil).toISOString() : null;
        }
        if (modalNotes) body.notes = modalNotes;
      } else if (modalAction === 'extend') {
        body.days = parseInt(modalDays, 10);
        if (modalNotes) body.notes = modalNotes;
      }
      // cancel: только target_user_id

      const res = await callAdminAction(jwt, body);
      if (res.ok) {
        pushToast(t('Выполнено', 'Done'));
        setModalUserId(null);
        setModalAction(null);
        void loadUsers();
        if (expandedId === modalUserId) void loadDetails(modalUserId);
      } else {
        pushToast(t('Ошибка: ', 'Error: ') + (res.error ?? '?'));
      }
    } catch (e: unknown) {
      pushToast((e instanceof Error ? e.message : String(e)));
    } finally {
      setModalBusy(false);
    }
  };

  // ─── Фильтрация ───────────────────────────────────────────────────────────

  const filtered = search.trim()
    ? users.filter(u => {
        const q = search.toLowerCase();
        return (
          u.email.toLowerCase().includes(q) ||
          u.id.toLowerCase().includes(q) ||
          (u.public_user_id?.toLowerCase().includes(q) ?? false)
        );
      })
    : users;

  // ─── Guard render ─────────────────────────────────────────────────────────

  if (auth.loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader size={20} className="animate-spin text-muted" />
      </div>
    );
  }

  if (entLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader size={20} className="animate-spin text-muted" />
      </div>
    );
  }

  if (!user || !entitlement.isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Shield size={32} className="mx-auto text-muted" />
          <p className="text-[13px] text-muted">{t('Доступ запрещён', 'Access denied')}</p>
        </div>
      </div>
    );
  }

  // ─── Рендер ───────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 max-w-4xl">
      {/* Заголовок */}
      <div className="flex items-center gap-3 mb-6">
        <Shield size={18} className="text-accent shrink-0" />
        <h2 className="font-display text-[18px] font-semibold">
          {t('Администрирование', 'Administration')}
        </h2>
        <span className="text-[11px] text-muted px-2 py-0.5 rounded bg-surface-alt border border-border-soft">
          admin
        </span>
        <button
          onClick={() => void loadUsers()}
          disabled={loading}
          className="ml-auto p-1.5 rounded hover:bg-surface-alt border border-border-soft transition-colors disabled:opacity-50"
          title={t('Обновить', 'Refresh')}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin text-muted' : 'text-muted'} />
        </button>
      </div>

      {/* Поиск */}
      <div className="relative mb-4">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('Поиск по email, TF-ID или user_id…', 'Search by email, TF-ID or user_id…')}
          className="w-full pl-8 pr-3 py-2 text-[13px] bg-surface-alt border border-border-soft rounded-md focus:outline-none focus:border-accent/60"
        />
      </div>

      {/* Счётчик */}
      <p className="text-[12px] text-muted mb-3">
        {t(`${filtered.length} из ${users.length} пользователей`, `${filtered.length} of ${users.length} users`)}
      </p>

      {/* Список */}
      {loading && users.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={20} className="animate-spin text-muted" />
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(u => {
            const ent = u.entitlement;
            const badge = planBadge(ent?.plan ?? 'free');
            const isExpanded = expandedId === u.id;

            return (
              <div key={u.id} className="bg-surface border border-border-soft rounded-lg overflow-hidden">
                {/* Строка пользователя */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-alt/50 transition-colors select-none"
                  onClick={() => handleExpand(u.id)}
                >
                  {isExpanded
                    ? <ChevronDown size={14} className="text-muted shrink-0" />
                    : <ChevronRight size={14} className="text-muted shrink-0" />
                  }

                  {/* Email / TF-ID / user_id */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{u.email}</div>
                    <div className="flex items-center gap-2 min-w-0">
                      {u.public_user_id && (
                        <span className="text-[11px] text-accent font-mono shrink-0">
                          {u.public_user_id}
                        </span>
                      )}
                      {u.email !== u.id && (
                        <span className="text-[11px] text-muted font-mono truncate">{u.id}</span>
                      )}
                    </div>
                  </div>

                  {/* Бейдж плана */}
                  <span
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full text-white shrink-0"
                    style={{ background: badge.color }}
                  >
                    {badge.label}
                  </span>

                  {/* valid_until */}
                  {ent?.valid_until && (
                    <span className="text-[11px] text-muted shrink-0 hidden sm:block">
                      {t('до ', 'until ')}
                      {fmtDate(ent.valid_until)}
                    </span>
                  )}

                  {/* auto_renew */}
                  {ent?.auto_renew && (
                    <span className="text-[11px] text-accent shrink-0">
                      {t('авто', 'auto')}
                    </span>
                  )}
                  {ent?.cancel_at_period_end && (
                    <span className="text-[11px] text-warning shrink-0">
                      {t('отменяется', 'cancelling')}
                    </span>
                  )}

                  {/* Кнопки действий */}
                  <div
                    className="flex items-center gap-1 ml-2 shrink-0"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        setModalUserId(u.id);
                        setModalAction('set-plan');
                        setModalPlan(ent?.plan ?? 'pro');
                        setModalValidUntil('');
                        setModalNotes('');
                      }}
                      className="p-1.5 rounded hover:bg-surface-alt border border-border-soft transition-colors"
                      title={t('Установить план', 'Set plan')}
                    >
                      <UserCog size={13} className="text-muted" />
                    </button>
                    <button
                      onClick={() => {
                        setModalUserId(u.id);
                        setModalAction('extend');
                        setModalDays('30');
                        setModalNotes('');
                      }}
                      className="p-1.5 rounded hover:bg-surface-alt border border-border-soft transition-colors"
                      title={t('Продлить', 'Extend')}
                    >
                      <Plus size={13} className="text-muted" />
                    </button>
                    {ent?.plan === 'pro' && !ent?.cancel_at_period_end && (
                      <button
                        onClick={() => {
                          setModalUserId(u.id);
                          setModalAction('cancel');
                          setModalNotes('');
                        }}
                        className="p-1.5 rounded hover:bg-surface-alt border border-border-soft transition-colors"
                        title={t('Отменить автопродление', 'Cancel auto-renewal')}
                      >
                        <Ban size={13} className="text-muted" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Раскрытые детали */}
                {isExpanded && (
                  <div className="border-t border-border-soft px-4 py-3 space-y-4">
                    {detailLoading ? (
                      <div className="flex items-center gap-2 text-[12px] text-muted py-2">
                        <Loader size={13} className="animate-spin" />
                        {t('Загрузка…', 'Loading…')}
                      </div>
                    ) : (
                      <>
                        {/* Entitlement details */}
                        {ent && (
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
                            <div className="text-muted">{t('Источник', 'Source')}</div>
                            <div className="font-mono">{ent.source ?? '—'}</div>
                            <div className="text-muted">{t('Обновлено', 'Updated')}</div>
                            <div>{fmtDateTime(ent.updated_at)}</div>
                            <div className="text-muted">{t('Последняя оплата', 'Last payment')}</div>
                            <div>{fmtDateTime(ent.last_payment_at ?? null)}</div>
                            {ent.renewal_attempts_count != null && ent.renewal_attempts_count > 0 && (
                              <>
                                <div className="text-muted">{t('Попытки продления', 'Renewal attempts')}</div>
                                <div className="text-warning">{ent.renewal_attempts_count}</div>
                              </>
                            )}
                            {ent.notes && (
                              <>
                                <div className="text-muted col-span-1">{t('Заметки', 'Notes')}</div>
                                <div className="col-span-1 text-[11px] text-muted break-words">{ent.notes}</div>
                              </>
                            )}
                          </div>
                        )}

                        {/* Renewal attempts */}
                        {attempts.length > 0 && (
                          <div>
                            <div className="flex items-center gap-1.5 text-[12px] font-medium mb-1.5">
                              <Clock size={12} />
                              {t('История попыток продления', 'Renewal attempts log')}
                            </div>
                            <div className="space-y-1">
                              {attempts.map(a => (
                                <div
                                  key={a.id}
                                  className="flex items-start gap-2 text-[11.5px] py-1 border-b border-border-soft/40 last:border-0"
                                >
                                  {a.status === 'succeeded'
                                    ? <Check size={11} className="text-success mt-0.5 shrink-0" />
                                    : a.status === 'canceled'
                                    ? <X size={11} className="text-error mt-0.5 shrink-0" />
                                    : <AlertTriangle size={11} className="text-warning mt-0.5 shrink-0" />
                                  }
                                  <div className="flex-1 min-w-0">
                                    <span className="font-medium">#{a.attempt_number} </span>
                                    <span className={
                                      a.status === 'succeeded' ? 'text-success' :
                                      a.status === 'canceled' ? 'text-error' : 'text-warning'
                                    }>{a.status}</span>
                                    {a.error_code && (
                                      <span className="text-muted"> — {a.error_code}</span>
                                    )}
                                  </div>
                                  <span className="text-muted shrink-0">{fmtDate(a.attempted_at)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Payment events */}
                        {events.length > 0 && (
                          <div>
                            <div className="flex items-center gap-1.5 text-[12px] font-medium mb-1.5">
                              <CreditCard size={12} />
                              {t('Платёжные события', 'Payment events')}
                            </div>
                            <div className="space-y-1">
                              {events.map(ev => (
                                <div
                                  key={ev.id}
                                  className="flex items-center gap-2 text-[11.5px] py-1 border-b border-border-soft/40 last:border-0"
                                >
                                  <span className="text-muted font-mono truncate max-w-[160px]" title={ev.external_id}>
                                    {ev.external_id.slice(0, 16)}…
                                  </span>
                                  <span className="text-[11px] truncate flex-1">{ev.event_type}</span>
                                  <span className="text-muted shrink-0">{fmtDate(ev.created_at)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {attempts.length === 0 && events.length === 0 && (
                          <p className="text-[12px] text-muted py-1">
                            {t('Нет истории платежей', 'No payment history')}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Модалка действия ──────────────────────────────────────────────── */}
      {modalUserId && modalAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={e => { if (e.target === e.currentTarget) { setModalUserId(null); setModalAction(null); } }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Modal */}
          <div className="relative bg-surface border border-border-soft rounded-xl shadow-2xl p-5 w-full max-w-sm mx-4 space-y-4">
            <h3 className="font-display text-[15px] font-semibold">
              {modalAction === 'set-plan' && t('Установить план', 'Set plan')}
              {modalAction === 'extend'   && t('Продлить доступ', 'Extend access')}
              {modalAction === 'cancel'   && t('Отменить автопродление', 'Cancel auto-renewal')}
            </h3>

            {/* Пользователь */}
            <div className="text-[12px] text-muted font-mono truncate">
              {users.find(u => u.id === modalUserId)?.email ?? modalUserId}
            </div>

            {/* set-plan поля */}
            {modalAction === 'set-plan' && (
              <div className="space-y-3">
                <div>
                  <label className="text-[12px] text-muted block mb-1">
                    {t('План', 'Plan')}
                  </label>
                  <select
                    value={modalPlan}
                    onChange={e => setModalPlan(e.target.value)}
                    className="w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px] focus:outline-none"
                  >
                    <option value="free">Free</option>
                    <option value="trial">Trial</option>
                    <option value="pro">Pro</option>
                    <option value="lifetime">Lifetime</option>
                  </select>
                </div>
                {(modalPlan === 'pro' || modalPlan === 'trial') && (
                  <div>
                    <label className="text-[12px] text-muted block mb-1">
                      {t('Действует до', 'Valid until')}
                    </label>
                    <input
                      type="date"
                      value={modalValidUntil}
                      onChange={e => setModalValidUntil(e.target.value)}
                      className="w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px] focus:outline-none"
                    />
                  </div>
                )}
              </div>
            )}

            {/* extend поля */}
            {modalAction === 'extend' && (
              <div>
                <label className="text-[12px] text-muted block mb-1">
                  {t('Добавить дней', 'Add days')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={modalDays}
                  onChange={e => setModalDays(e.target.value)}
                  className="w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px] focus:outline-none"
                />
              </div>
            )}

            {/* cancel: подтверждение */}
            {modalAction === 'cancel' && (
              <p className="text-[13px] text-muted leading-relaxed">
                {t(
                  'Автопродление будет отменено. Доступ сохранится до конца оплаченного периода.',
                  'Auto-renewal will be cancelled. Access remains until the end of the current period.',
                )}
              </p>
            )}

            {/* Заметки (set-plan / extend) */}
            {modalAction !== 'cancel' && (
              <div>
                <label className="text-[12px] text-muted block mb-1">
                  {t('Заметка (необязательно)', 'Note (optional)')}
                </label>
                <input
                  type="text"
                  value={modalNotes}
                  onChange={e => setModalNotes(e.target.value)}
                  placeholder={t('Причина изменения…', 'Reason for change…')}
                  className="w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px] focus:outline-none"
                />
              </div>
            )}

            {/* Кнопки */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setModalUserId(null); setModalAction(null); }}
                disabled={modalBusy}
                className="flex-1 px-3 py-2 text-[13px] rounded-md border border-border-soft hover:bg-surface-alt transition-colors disabled:opacity-50"
              >
                {t('Отмена', 'Cancel')}
              </button>
              <button
                onClick={() => void handleModalConfirm()}
                disabled={modalBusy}
                className={
                  'flex-1 px-3 py-2 text-[13px] rounded-md text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 ' +
                  (modalAction === 'cancel' ? 'bg-error hover:bg-error/90' : 'bg-accent hover:bg-accent/90')
                }
              >
                {modalBusy
                  ? <><Loader size={13} className="animate-spin" />{t('…', '…')}</>
                  : modalAction === 'cancel'
                  ? <><Ban size={13} />{t('Отменить', 'Cancel renewal')}</>
                  : <><Check size={13} />{t('Применить', 'Apply')}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar-кнопка назад */}
      <div className="mt-8 pt-4 border-t border-border-soft">
        <button
          onClick={() => navigate('/settings')}
          className="text-[12px] text-muted hover:text-accent transition-colors"
        >
          ← {t('Назад в настройки', 'Back to settings')}
        </button>
      </div>
    </div>
  );
}
