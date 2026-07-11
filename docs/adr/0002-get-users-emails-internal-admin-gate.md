# 0002. get_users_emails — внутренний admin-гейт вместо REVOKE от authenticated

- Статус: accepted
- Дата: 2026-07-10
- Связано: находка N15, миграция `0020_wave2_security_hardening.sql`, ветка `wave2-fixes`

## Контекст

RPC `public.get_users_emails(user_ids uuid[])` — `SECURITY DEFINER`, возвращает
`{id, email}` из `auth.users`. На живой схеме `EXECUTE` выдан роли `authenticated`
(находка N15). Формально это означало, что любой залогиненный пользователь мог
дёрнуть `/rest/v1/rpc/get_users_emails` и получить чужие email.

Ключевой вопрос перед фиксом — КТО и с какой ролью вызывает функцию. Проверены
все вызовы в кодовой базе (frontend, edge-функции, миграции):

- Единственный вызов — `src/pages/AdminPage.tsx:189`:
  `await supabase.rpc('get_users_emails', { user_ids: userIds })`.
- Вызов идёт из КЛИЕНТА под authenticated-JWT администратора. Ключа
  `service_role` на клиенте нет (подтверждено комментарием в самом AdminPage:
  service_role на клиенте отсутствует).

Значит, глобальный `REVOKE EXECUTE FROM authenticated` сломал бы админ-панель:
легитимный admin-клиент ходит именно под ролью `authenticated`, а не под
`service_role`.

## Решение

Выбран вариант «внутренний admin-гейт», а НЕ отзыв прав:

- `EXECUTE` для роли `authenticated` СОХРАНЯЕМ (нужен admin-клиенту);
  `PUBLIC`/`anon` — REVOKE.
- Проверка прав перенесена ВНУТРЬ функции. Единый источник истины —
  `public.is_admin_user()` (`source='seed' AND plan='lifetime'`), а не инлайн-копия
  admin-логики (устраняем дублирование определения «кто admin»).
- Любой не-admin `authenticated` получает `EXCEPTION 'Forbidden: admin only'` →
  утечка чужих email невозможна.
- `search_path = public, auth` НЕ меняем (нужен для доступа к `auth.users`).

Альтернатива (REVOKE + вызов только через service_role из edge-функции)
отклонена: потребовала бы новую edge-функцию-прокси и переписывание AdminPage,
без выигрыша в безопасности по сравнению с внутренним гейтом.

## Последствия

Плюсы: утечка закрыта; админка продолжает работать без изменений фронта;
admin-определение консолидировано в одной функции `is_admin_user()`.

Минусы: `EXECUTE` формально остаётся у `authenticated` — защита держится на теле
функции, а не на GRANT. Это осознанный компромисс; покрыт pgTAP-тестом
(`tests/04_wave2_test.sql`: обычный юзер → Forbidden, admin → корректный email).

Замечание по критичности N15: в roadmap находка помечена MEDIUM-HIGH исходя из
одного лишь факта `EXECUTE=authenticated`. На практике внутренний admin-гейт в
функции уже существовал (миграция `0017_admin_rpc.sql`), поэтому фактическая
утечка не воспроизводилась; миграция `0020` закрепляет гейт на едином
`is_admin_user()` и добавляет регрессионный тест.

Применение на прод: требуется применение миграции `0020` (на момент записи —
не применена).
