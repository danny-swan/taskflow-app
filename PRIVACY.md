# Политика конфиденциальности TaskFlow

Дата вступления в силу: 3 июля 2026

## Кто мы

TaskFlow — это персональный менеджер задач с открытым исходным кодом, разрабатываемый Дмитрием Лебедевым (danny-swan). Приложение распространяется под лицензией PolyForm Noncommercial 1.0.0.

Связь: [github.com/danny-swan/taskflow-app/issues](https://github.com/danny-swan/taskflow-app/issues) — здесь можно задать вопрос, сообщить о баге или запросить свои данные. Отдельный контактный email появится позже.

## Какие данные мы собираем

### Данные аккаунта (обязательные для регистрации)

- **Email** — используется для входа и восстановления пароля
- **Хеш пароля** — при регистрации через email/password. **Важно:** сам пароль нигде не хранится — ни у нас, ни в Supabase. Хеш — это односторонняя криптографическая свёртка (bcrypt), из которой невозможно восстановить исходный пароль. Даже разработчик не может узнать ваш пароль. При входе Supabase хеширует введённый пароль тем же алгоритмом и сравнивает с сохранённым хешем.
- **Дата регистрации, дата последнего входа** — генерируются автоматически

### Телеметрия (сбор при использовании приложения)

- **Тип события:** регистрация, вход/выход, старт приложения, создание/удаление/выполнение задачи (без содержимого задач)
- **Версия приложения** (например, 0.9.10)
- **Операционная система** и её версия (например, Windows 10.0.19045)
- **Время события**

### Что мы НЕ собираем

- **Содержимое задач** — названия, описания, теги, дедлайны хранятся ТОЛЬКО локально в SQLite на вашем устройстве и никогда не отправляются на наши серверы
- **Пароли в открытом виде** — только необратимые bcrypt-хеши
- IP-адрес не сохраняется дольше стандартных серверных логов (30 дней у Supabase)
- Никакой рекламной или маркетинговой аналитики
- Никакой передачи данных третьим лицам для коммерческих целей

## Где хранятся данные

- **Локальные данные (задачи, теги, настройки):** SQLite-файл на вашем устройстве. Полностью под вашим контролем.
- **Данные аккаунта и телеметрия:** Supabase (Postgres), регион Frankfurt (EU). Supabase Inc. — субпроцессор, соблюдающий GDPR.

## Ваши права

Вы имеете право:

1. **Получить копию своих данных** — откройте issue в [github.com/danny-swan/taskflow-app/issues](https://github.com/danny-swan/taskflow-app/issues) с меткой `data-request`, отправим JSON-выгрузку в течение 30 дней
2. **Удалить аккаунт** — Настройки → Аккаунт → «Удалить аккаунт». Все данные аккаунта и телеметрия удаляются немедленно. Локальные задачи остаются на вашем устройстве и удаляются отдельно (удалением файла БД).
3. **Отозвать согласие** — удаление аккаунта эквивалентно отзыву согласия
4. **Пожаловаться в надзорный орган** — если считаете, что мы нарушаем законодательство

## Зачем нам эти данные

- **Аутентификация** — иначе невозможно связать сессии одного и того же пользователя
- **Понимание аудитории** — сколько людей пользуется приложением, какие версии актуальны, на каких OS работает; это помогает решать, какие функции разрабатывать и какие версии поддерживать
- **Отладка** — при жалобе на баг мы можем посмотреть, какие версии затронуты

## Сколько данные хранятся

- Пока у вас есть аккаунт — бессрочно
- После удаления аккаунта — все данные удаляются немедленно, серверные логи через 30 дней

## Изменения политики

При существенных изменениях мы уведомим внутри приложения при следующем входе.

---

# Privacy Policy for TaskFlow

Effective date: July 3, 2026

## Who we are

TaskFlow is an open-source personal task manager developed by Daniil Lebedev (danny-swan). The app is distributed under the PolyForm Noncommercial 1.0.0 license.

Contact: [github.com/danny-swan/taskflow-app/issues](https://github.com/danny-swan/taskflow-app/issues) — ask questions, report bugs, or request your data here. A dedicated contact email will be added later.

## What data we collect

### Account data (required for registration)

- **Email** — used for login and password recovery
- **Password hash** — for email/password registration. **Important:** the raw password is never stored — not by us, not by Supabase. A hash is a one-way cryptographic digest (bcrypt) from which the original password cannot be recovered. Not even the developer can see your password. On login, Supabase hashes the entered password with the same algorithm and compares it to the stored hash.
- **Registration and last login dates** — generated automatically

### Telemetry (collected during app usage)

- **Event type:** signup, login/logout, app start, task created/deleted/completed (without task content)
- **App version** (e.g., 0.9.10)
- **Operating system** and its version (e.g., Windows 10.0.19045)
- **Event timestamp**

### What we do NOT collect

- **Task content** — titles, descriptions, tags, deadlines are stored ONLY locally in SQLite on your device and never leave it
- **Passwords in plain text** — only irreversible bcrypt hashes
- IP addresses are not retained beyond standard server logs (30 days at Supabase)
- No advertising or marketing analytics
- No transfer of data to third parties for commercial purposes

## Where data is stored

- **Local data (tasks, tags, settings):** SQLite file on your device. Fully under your control.
- **Account data and telemetry:** Supabase (Postgres), Frankfurt (EU) region. Supabase Inc. is a GDPR-compliant subprocessor.

## Your rights

You have the right to:

1. **Get a copy of your data** — open an issue at [github.com/danny-swan/taskflow-app/issues](https://github.com/danny-swan/taskflow-app/issues) with the `data-request` label, we'll send a JSON export within 30 days
2. **Delete your account** — Settings → Account → «Delete account». All account data and telemetry are deleted immediately. Local tasks remain on your device and can be deleted separately by removing the database file.
3. **Withdraw consent** — account deletion is equivalent to consent withdrawal
4. **File a complaint** with a supervisory authority if you believe we violate applicable law

## Why we need this data

- **Authentication** — without it we cannot link sessions of the same user
- **Understanding the audience** — how many people use the app, which versions are current, which OSes; helps decide what features to build and which versions to support
- **Debugging** — when a bug is reported we can check which versions are affected

## How long we retain data

- As long as you have an account — indefinitely
- After account deletion — all data is deleted immediately, server logs after 30 days

## Policy changes

We'll notify you in-app at the next login for material changes.
