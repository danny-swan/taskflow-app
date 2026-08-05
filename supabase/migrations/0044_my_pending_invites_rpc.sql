-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0044_my_pending_invites_rpc.sql — название пространства и профиль
-- пригласившего в карточке входящего приглашения (F56, ADR 0036).
--
-- ПРОБЛЕМА (доказано на проде под ролью приглашённого):
-- карточка приглашения в сайдбаре (`MyInvitesSection`) показывает нейтральное
-- «Приглашение в общее пространство» без названия ws и без того, кто пригласил.
-- Это не недоделка UI, а следствие RLS: приглашённый ЕЩЁ НЕ участник
-- пространства, поэтому
--   • `select name from sync_workspaces where id = <ws>` → 0 строк
--     (политика отдаёт пространство только его участникам);
--   • `select … from profiles where id = <inviter>` → 0 строк
--     (на profiles только own-row `profiles_select_own`).
-- Саму строку приглашения приглашённый читает нормально
-- (`invites_select_ws_role`: target_user_id = auth.uid() OR owner ws), но в ней
-- лежат только идентификаторы, а не отображаемые поля. Решение Wave B было
-- «approach 5.b — нейтральный заголовок без backend-правок»; здесь оно
-- пересматривается (см. ADR 0036).
--
-- РЕШЕНИЕ: SECURITY DEFINER RPC, которая отдаёт вызывающему ЕГО СОБСТВЕННЫЕ
-- pending-приглашения, дополненные названием пространства и публичным минимумом
-- профиля пригласившего. Образец безопасности — get_workspace_member_profiles
-- (0043, ADR 0031):
--   • гейт по строке приглашения: `i.target_user_id = auth.uid()`. Никаких
--     параметров у функции нет вообще, поэтому подобрать чужой инвайт нельзя;
--   • отдаётся только то, что и так будет видно после accept: имя пространства
--     + публичный TF-id/ник/аватар/bio пригласившего. Никакого email, никаких
--     приватных полей profiles (закреплено pgTAP-проверкой сигнатуры);
--   • EXECUTE только authenticated (anon отсечён и грантом, и `auth.uid()`);
--   • функция ТОЛЬКО читает: логика приглашений, членства и sync-цикла не
--     меняется (ADR 0008/0009/0011), мутации по-прежнему идут через
--     accept_invite / reject_invite / cancel_invite из 0032.
--
-- Фильтр строк совпадает с прежним клиентским запросом `listMyPendingInvites`
-- (target_user_id = я, status = 'pending', сортировка по created_at desc), так
-- что список остаётся тем же — меняется только состав колонок.
-- `left join` на sync_workspaces и profiles — защитный: сейчас строка
-- пространства не может пропасть (FK sync_workspace_invites.workspace_id
-- ON DELETE CASCADE удалил бы и само приглашение, а «удаление» пространства в
-- продукте мягкое — deleted_at), но с inner join любая будущая рассинхронизация
-- молча выкинула бы приглашение из списка. С left join приглашение остаётся, а
-- `workspace_name`/профиль приходят как NULL — UI в этом случае показывает
-- прежний нейтральный заголовок.
--
-- Идемпотентна: create or replace + revoke/grant.
-- ============================================================================

create or replace function public.get_my_pending_invites()
returns table (
  id                      text,
  workspace_id            text,
  workspace_name          text,
  role                    text,
  status                  text,
  expires_at              timestamptz,
  created_at              timestamptz,
  target_public_user_id   text,
  inviter_user_id         uuid,
  inviter_public_user_id  text,
  inviter_nickname        text,
  inviter_avatar_variant  int,
  inviter_avatar_color    text,
  inviter_bio             text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    i.id,
    i.workspace_id,
    w.name                            as workspace_name,
    i.role,
    i.status,
    i.expires_at,
    i.created_at,
    i.target_public_user_id,
    i.inviter_user_id,
    p.public_user_id                  as inviter_public_user_id,
    p.nickname                        as inviter_nickname,
    coalesce(p.avatar_variant, 1)::int as inviter_avatar_variant,
    p.avatar_color                    as inviter_avatar_color,
    p.bio                             as inviter_bio
  from public.sync_workspace_invites i
  left join public.sync_workspaces w on w.id = i.workspace_id
  left join public.profiles        p on p.id = i.inviter_user_id
  where (select auth.uid()) is not null
    and i.target_user_id = (select auth.uid())
    and i.status = 'pending'
  order by i.created_at desc;
$$;

comment on function public.get_my_pending_invites() is
  'Входящие pending-приглашения ВЫЗЫВАЮЩЕГО (гейт i.target_user_id = auth.uid(), '
  'параметров нет) вместе с названием пространства и публичным минимумом профиля '
  'пригласившего (public_user_id/nickname/avatar_variant/avatar_color/bio). '
  'SECURITY DEFINER: обходит RLS sync_workspaces и own-row RLS profiles, которые '
  'иначе скрывают эти поля от ещё-не-участника. Email и приватные поля не '
  'возвращаются. EXECUTE только authenticated. См. ADR 0036, находка F56.';

revoke execute on function public.get_my_pending_invites() from anon, public;
grant  execute on function public.get_my_pending_invites() to authenticated;

-- ROLLBACK (не автоматический — применить вручную если нужно):
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.get_my_pending_invites();
-- COMMIT;
-- Клиент это переживёт: lib/invites.listMyPendingInvites при ошибке RPC падает
-- на прежний прямой SELECT (без имени ws и профиля пригласившего).
