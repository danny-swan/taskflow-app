-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0033_fix_overdue_events_updated_at.sql — снятие ошибочного updated_at-триггера
-- с append-only таблицы sync_overdue_events (Wave B, PR-b-06 «hardening»).
--
-- Техплан: docs/architecture/wave-b-plan.md §4.6. Закрывает известный quirk,
-- задокументированный в PR-b-02 (тест 14, шапка): любой UPDATE строки
-- sync_overdue_events падал с ошибкой
--     record "new" has no field "updated_at"
--     PL/pgSQL function set_updated_at() line 3 at assignment
--
-- ─── ТОЧНАЯ ПРИЧИНА ──────────────────────────────────────────────────────────
-- Триггерная функция public.set_updated_at() (0005) выполняет
-- `NEW.updated_at = now()`. Она навешивается триггером trg_set_updated_at на
-- sync-таблицы, У КОТОРЫХ ЕСТЬ колонка updated_at (см. комментарий 0005 §24).
-- Но 0005 (строки 45-48) ОШИБОЧНО навесил её и на sync_overdue_events — таблицу,
-- которая по дизайну append-only (0002 §8, комментарий «Append-only история
-- пересечений дедлайна») и НЕ имеет ни updated_at, ни version. Как только под
-- строкой этой таблицы выполняется UPDATE, plpgsql пытается присвоить
-- несуществующее поле NEW.updated_at и падает — независимо от RLS/ролей.
--
-- ─── ПОЧЕМУ ВАРИАНТ B (снять триггер), А НЕ ВАРИАНТ A (добавить колонку) ──────
-- sync_overdue_events — принципиально append-only лог событий «дедлайн пройден»:
--   • 0002 §8 явно объявляет её append-only; CREATE TABLE не содержит updated_at
--     и version (в отличие от 5 остальных sync-таблиц).
--   • Клиентский sync-слой это фиксирует: src/lib/sync/mappers.ts
--     (CloudOverdueEventPayload, комментарий «НЕТ updated_at и version в облачной
--     схеме — append-only»; pull-курсор идёт по id, не по updated_at —
--     src/lib/sync/pull.ts syncCursorColumn/applyCloudRowOverdueEvents).
-- Добавление updated_at (вариант A) рассинхронизировало бы облачную схему с
-- клиентскими типами и семантикой курсора, не давая никакой пользы (LWW для этой
-- таблицы идёт по монотонному uuidv7-id, а не по времени обновления).
-- Правильный фикс — убрать триггер, который вообще не должен был здесь стоять.
--
-- Это НЕ только тестовый артефакт: push-слой отправляет и upsert, и soft-delete
-- через .upsert(onConflict:'id') (src/lib/sync/push.ts). Повторный push/soft-delete
-- уже существующего в облаке overdue-события превращается в UPDATE-on-conflict и
-- до этого фикса падал в проде на этом же триггере. Снятие триггера чинит и его.
--
-- Идемпотентна: DROP TRIGGER IF EXISTS. Совместимо с vanilla Postgres 15 (CI).
-- На прод НЕ применяется до решения релизить эпик «Пространства».
-- ============================================================================
SET LOCAL client_min_messages = warning;

-- Снимаем ошибочно навешенный updated_at-триггер. RLS-политики (own-row из 0002,
-- ролевые из 0031) и FK+CASCADE (0030) остаются на месте: UPDATE-флоу под ролями
-- продолжает работать, просто уже без падения на несуществующей колонке.
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.sync_overdue_events;

COMMENT ON TABLE public.sync_overdue_events IS
  'Append-only история пересечений дедлайна для графика на дашборде. Без updated_at/version (LWW по монотонному id). Триггер trg_set_updated_at СНЯТ в 0033 (0005 навесил его ошибочно — колонки updated_at нет).';
