# Architecture Decision Records (ADR)

ADR — это запись одного значимого архитектурного решения. Правила ведения:

- **Один immutable файл на решение.** Каждое решение — отдельный файл.
- **Сквозная нумерация** `000N` (`0001`, `0002`, …) в порядке принятия.
- **Не редактируются после `accepted`.** Если решение отменяется или заменяется,
  создаётся НОВЫЙ ADR с новым номером, а старому проставляется статус `superseded`
  (со ссылкой на заменяющий ADR). Так сохраняется история решений «как было».

Возможные статусы: `proposed`, `accepted`, `superseded`, `deprecated`.

## Индекс

| # | Решение | Статус | Файл |
|---|---------|--------|------|
| 0001 | payment_method_id vs external_id — источник истины для токена ЮKassa | accepted | 0001-payment-method-id-vs-external-id.md |
| 0002 | get_users_emails — внутренний admin-гейт вместо REVOKE от authenticated (N15) | accepted | 0002-get-users-emails-internal-admin-gate.md |
| 0003 | renewal idempotency-guard — сверка GET /v3/payments до создания платежа автопродления (N10) | accepted | 0003-renewal-idempotency-guard.md |
| 0004 | rate limiting — table-based счётчик в Postgres на публичных эндпоинтах (N13) | accepted | 0004-rate-limiting-table-based.md |
| 0005 | shared workspaces — роли/инвайты по TF-ID + `workspace_id` text→uuid + FK + ON DELETE CASCADE (Wave B) | accepted | 0005-shared-workspaces.md |
