-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- v0.9.35-dev.6 — Migration 0008
--
-- Добавляет колонку activation_requests.notified_at для идемпотентности
-- Edge Function `activation-notify`. Функция помечает строку через
-- атомарный UPDATE ... WHERE notified_at IS NULL, что защищает от повторных
-- срабатываний Database Webhook при retry.
--
-- Колонка не индексируется (низкая кардинальность запросов).

alter table public.activation_requests
  add column if not exists notified_at timestamptz;

comment on column public.activation_requests.notified_at is
  'Отметка времени отправки уведомления админу (activation-notify Edge Function). NULL = ещё не нотифицировали. Идемпотентный флаг.';
