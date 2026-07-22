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
| 0006 | F12 (P4): admin-список пользователей — SECURITY DEFINER RPC `get_admin_users_summary` с admin-гейтом вместо GRANT на view; view дополнен `public_user_id` | accepted | 0006-admin-users-list-security-definer-rpc.md |
| 0007 | F13: краш открытия задачи в shared (стабильная `EMPTY_RECORDS` в zustand-селекторе) + FK `client_id` (push всегда текущее устройство) + дедуп осиротевших personal-ws | accepted | 0007-workspace-crash-clientid-dedup.md |
| 0008 | F14: полный pull членства в двух скоупах (`user_id` + `workspace_id`) — участники shared видны, ws восстанавливаются при рестарте; refresh сайдбара при leave | accepted | 0008-workspace-members-full-pull-leave-refresh.md |
| 0009 | F15: `accept_invite` — `INSERT ... ON CONFLICT (workspace_id, user_id) DO UPDATE` (реактивация soft-deleted членства после leave, стабильный uuid) | accepted | 0009-accept-invite-upsert-membership.md |
| 0010 | F16: авто-обнаружение и восстановление битой локальной SQLite при старте (`detectAndRecoverCorruption`, `SqliteCorruptError`/`withCorruptionGuard`, prune-skip, тост + reload) | accepted | 0010-sqlite-corruption-auto-recovery.md |
| 0011 | F17: реконсиль uuid членства при рассинхроне local↔server (fallback-матчинг `applyCloudRowMembers` по `(workspace_id, user_id)` + переклейка uuid; откат F16-эскалации 2067→corruption) | accepted | 0011-membership-uuid-mismatch-reconcile.md |
