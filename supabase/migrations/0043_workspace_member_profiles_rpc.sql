-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0043_workspace_member_profiles_rpc.sql — публичные профили участников
-- пространства (F40, ADR 0031).
--
-- ПРОБЛЕМА (доказано на проде): на public.profiles действуют только own-row
-- политики `profiles_select_own` / `profiles_update_own` (auth.uid() = id),
-- поэтому клиент не может прочитать ни ник, ни TF-id, ни аватар ДРУГИХ
-- участников пространства. Из-за этого список участников показывал первые 8
-- символов внутреннего uuid и одинаковый аватар-заглушку.
--
-- РЕШЕНИЕ: SECURITY DEFINER RPC, которая по id пространства возвращает
-- публичный минимум профилей его живых участников. Образец безопасности —
-- find_user_by_public_id (0028) и get_admin_users_summary (0039):
--   • вызывающий обязан быть аутентифицирован;
--   • вызывающий обязан сам быть участником запрошенного пространства
--     (has_workspace_role(ws, uid, 'viewer')) — иначе пустой результат;
--   • отдаётся ТОЛЬКО косметика + публичный TF-id: public_user_id, nickname,
--     avatar_variant, avatar_color, bio. Никакого email, created_at и прочих
--     приватных полей;
--   • EXECUTE только authenticated (anon отсечён и грантом, и проверкой).
--
-- ВАЖНО: функция только ЧИТАЕТ. Логика членства, приглашений и sync-цикла не
-- меняется (ADR 0008/0009/0011), profiles в sync-цикле не участвует.
--
-- Идемпотентна: create or replace + revoke/grant.
-- ============================================================================

create or replace function public.get_workspace_member_profiles(p_workspace_id text)
returns table (
  user_id        uuid,
  public_user_id text,
  nickname       text,
  avatar_variant int,
  avatar_color   text,
  bio            text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    m.user_id,
    p.public_user_id,
    p.nickname,
    coalesce(p.avatar_variant, 1)::int as avatar_variant,
    p.avatar_color,
    p.bio
  from public.sync_workspace_members m
  join public.profiles p on p.id = m.user_id
  where (select auth.uid()) is not null
    and m.workspace_id = p_workspace_id
    and m.deleted_at is null
    and public.has_workspace_role(p_workspace_id, (select auth.uid()), 'viewer');
$$;

comment on function public.get_workspace_member_profiles(text) is
  'Публичные профили живых участников пространства (public_user_id/nickname/'
  'avatar_variant/avatar_color/bio) для отображения в списке участников. '
  'SECURITY DEFINER: обходит own-row RLS на profiles, но требует, чтобы вызывающий '
  'сам был участником этого пространства. Email и приватные поля не возвращаются. '
  'EXECUTE только authenticated. См. ADR 0031.';

revoke execute on function public.get_workspace_member_profiles(text) from anon, public;
grant  execute on function public.get_workspace_member_profiles(text) to authenticated;
