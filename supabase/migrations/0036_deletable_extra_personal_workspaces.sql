-- 0036_deletable_extra_personal_workspaces.sql
-- Bug #3 (Wave B): удаляемость дополнительных личных пространств.
--
-- ЧТО ДЕЛАЕМ И ЗАЧЕМ:
-- Триггерная функция block_personal_workspace_delete() (0028) сейчас запрещает
-- удаление ЛЮБОГО personal-пространства. Согласованное правило: неудаляемо только
-- ПЕРВОЕ (системное) личное пространство, создаваемое при регистрации. Его ID
-- детерминирован: 'ws_' || replace(owner_id, '-', '') (подтверждено на всех 4
-- prod personal-ws). Дополнительные personal (созданные вручную, лимит 2 в 0029)
-- должны быть удаляемыми — с каскадом по FK (0030).
--
-- РЕШЕНИЕ: переопределяем функцию так, чтобы блокировка срабатывала только когда
-- old.kind='personal' И old.id — это системный ID владельца. shared не трогаем.
--
-- Идемпотентно: CREATE OR REPLACE FUNCTION.

BEGIN;

CREATE OR REPLACE FUNCTION public.block_personal_workspace_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_system_id text;
begin
  if (select auth.uid()) is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Системное личное пространство = детерминированный ID от owner_id.
  v_system_id := 'ws_' || replace(old.owner_id::text, '-', '');

  -- Hard delete: блокируем только системное personal.
  if tg_op = 'DELETE'
     and old.kind = 'personal'
     and old.id = v_system_id then
    raise exception 'Основное личное пространство удалить нельзя.'
      using errcode = 'check_violation';
  end if;

  -- Soft delete (UPDATE deleted_at): блокируем только системное personal.
  if tg_op = 'UPDATE'
     and old.kind = 'personal'
     and old.id = v_system_id
     and new.deleted_at is not null
     and old.deleted_at is null then
    raise exception 'Основное личное пространство удалить нельзя.'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.block_personal_workspace_delete() FROM anon, authenticated, PUBLIC;

COMMIT;

-- ПРОВЕРКА (вручную):
-- Удаление дополнительного personal (id <> ws_<uid>) -> проходит, каскад чистит задачи.
-- Удаление системного personal (id = ws_<uid>) -> check_violation.
-- Удаление shared -> проходит (при наличии owner-membership и корректной RLS DELETE).

-- ROLLBACK (вернуть блокировку всех personal):
-- BEGIN;
--   CREATE OR REPLACE FUNCTION public.block_personal_workspace_delete() ... (версия 0028)
--   REVOKE EXECUTE ... FROM anon, authenticated, PUBLIC;
-- COMMIT;
