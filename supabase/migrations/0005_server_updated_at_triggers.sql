-- v0.9.35-dev.4: сервер задаёт updated_at на каждом UPDATE.
-- Клиент присылает свой updated_at в payload'е upsert'а — этим триггером
-- сервер его перезаписывает. Это гарантирует, что LWW (last-write-wins)
-- работает через серверные часы, а не через клиентские (которые могут
-- отставать/спешить/быть в другой TZ).
--
-- Не трогаем INSERT: там default now() уже стоит, а клиенту нужно чтобы
-- INSERT прошёл с его updated_at (иначе первый push перезапишет свежее
-- изменение) — на INSERT мы полагаемся на клиентский updated_at, а на UPDATE
-- уже сервер главный.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Применяем ко всем sync-таблицам, у которых есть колонка updated_at.
DROP TRIGGER IF EXISTS trg_set_updated_at ON public.sync_tasks;
CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON public.sync_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.sync_tags;
CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON public.sync_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.sync_statuses;
CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON public.sync_statuses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.sync_task_templates;
CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON public.sync_task_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.sync_overdue_events;
CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON public.sync_overdue_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.sync_settings;
CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON public.sync_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
