-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- v0.9.35-dev.5: добавляем sync_overdue_events в realtime publication.
--
-- В миграции 0002 таблицу сознательно не добавили («мало интересного для
-- realtime»). Но теперь у нас есть push overdue-событий, и клиент должен
-- увидеть новые события с других устройств почти мгновенно — это часть UX
-- «просроченный день перекочевал на другое устройство».
--
-- Идемпотентно через безопасный DO-блок: если таблица уже в publication —
-- ALTER бросит ошибку, которую мы проглотим.

do $$
begin
  begin
    alter publication supabase_realtime add table public.sync_overdue_events;
  exception
    when duplicate_object then null; -- уже добавлена
    when others then raise;
  end;
end $$;
