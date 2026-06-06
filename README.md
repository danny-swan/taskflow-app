<div align="center">

# TaskFlow

**Локальный канбан-менеджер задач для Windows**

[Скачать v0.8.17](https://github.com/danny-swan/taskflow-app/releases/latest) · [Возможности](#-возможности) · [Установка](#-установка) · [English](#english) · [Обновление](#-обновление-и-сохранность-данных)

[![Latest release](https://img.shields.io/github/v/release/danny-swan/taskflow-app?label=release&color=blue)](https://github.com/danny-swan/taskflow-app/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/danny-swan/taskflow-app/build.yml?branch=main)](https://github.com/danny-swan/taskflow-app/actions/workflows/build.yml)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6)](https://github.com/danny-swan/taskflow-app/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-green)](#-лицензия)

</div>

---

## 📋 Что это

**TaskFlow** — настольное приложение для управления задачами. Всё хранится локально в SQLite-файле на вашем компьютере: никакие данные не уходят в облако, не требуется регистрация и интернет. Подходит для личных задач, рабочих процессов и небольших проектов, где важна приватность.

Собрано на **Tauri 2** (Rust + React), весит ~5 МБ, запускается мгновенно, **не требует прав администратора**.

<div align="center">

> Темы: 🌞 светлая · 🌚 тёмная · 🩸 Akatsuki · 🍃 Konoha · языки интерфейса: RU / EN

</div>

---

## ✨ Возможности

### Задачи и канбан
- 🎯 **Канбан-доска** с произвольным набором блоков-статусов (создавайте, переименовывайте, перекрашивайте, скрывайте).
- 🖱 **Drag-and-drop** между статусами и в рамках одного конкретного — порядок сохраняется.
- 🏷 **Теги** с цветами и эмодзи, фильтрация и поиск по тегам и тексту.
- 📅 Дата начала, дата завершения, продолжительность задачи (автоматически).
- ✅ **Чек выполнения** — один клик помечает задачу как «Выполнено».
- ↩️ **Галя-Отмена для деструктивных действий** (v0.8.12) — возможность «Отменить» действие после удаления, перевода в архив или завершения задачи.

### Аналитика и обзор
- 📊 **Dashboard** — удобная сводка (всего задач, активные, выполненные, по тегам), графики по неделям/месяцам, тренды выполнения.
- 📈 **Statistics** — сбор статистики с возможностью разбивки и фильтрования по тегам и статусам.
- 🔍 Полнотекстовый поиск по названию и комментариям.

### Данные и сохранность
- 💾 **Резервные копии** — экспорт всей  Базы данных (БД) в JSON или Excel одной кнопкой, импорт обратно.
- 📁 **Меняемое расположение БД** — можно положить БД `data.db` в OneDrive / Dropbox / на сетевую папку и синхронизировать между ПК.
- 🔄 **Автоматические миграции БД** (v0.8.12) — `PRAGMA user_version`, обновление без потери данных.
- 📝 **Логирование** (v0.8.12) — `taskflow.log` с ротацией, доступ к файлу из Settings → «Диагностика».

### UX
- 🎨 **4 темы:** Light, Dark, Akatsuki, Konoha — переключение в один клик.
- 🌐 **2 языка интерфейса:** русский и английский.
- 💬 Случайная мотивационная цитата в шапке.
- ⌨️ **Горячие клавиши:** `1`–`5` для навигации, `/` — фокус в поиск, `N` — новая задача.
- 🎓 **Welcome-тур** (v0.8.12) — 5-шаговое знакомство для новичков, перезапуск из Help.

---

## 📦 Установка

Все варианты **не требуют прав администратора** и подходят для рабочих ПК с ограничениями.

| Файл | Размер | Когда выбирать |
|---|---|---|
| [**TaskFlow_0.8.xx_x64-setup.exe**] | ~4.8 МБ | ✅ **Рекомендуется** — NSIS-установщик, ставит в `%LOCALAPPDATA%\Programs\TaskFlow`, создаёт ярлык, обновляется поверх старой версии |
| [TaskFlow_0.8.xx_x64_ru-RU.msi] | ~6.3 МБ | MSI с русской локализацией мастера установки |
| [TaskFlow_0.8.xx_x64_en-US.msi] | ~6.3 МБ | MSI с английской локализацией мастера установки |
| [taskflow.exe] | ~15.4 МБ | **Portable** — просто запускайте, ничего не устанавливается |

> **Антивирус может ругаться на неподписанный `.exe`** — это нормально для opensource-приложений без коммерческой подписи кода. Можно добавить в исключения или собрать самостоятельно (см. [Сборка из исходников](#-сборка-из-исходников)).

---

## 🔄 Обновление и сохранность данных

База данных и настройки лежат **отдельно** от исполняемых файлов, поэтому обновление **не теряет данные**.

### Где хранятся данные

```
%APPDATA%\app.taskflow.desktop\
├── data.db          ← все задачи, статусы, теги, настройки
└── taskflow.log     ← лог приложения (с v0.8.12)
```

Откройте проводник → в адресной строке вставьте `%APPDATA%\app.taskflow.desktop` → попадёте в эту папку.

### Правильный порядок обновления

1. **Сделайте бэкап.** Settings → «Резервная копия» → «Создать бэкап». Сохраните `taskflow-backup-YYYY-MM-DD.json` в надёжное место.
2. **Запустите новый установщик поверх старой версии.** Удалять предыдущую не нужно — NSIS-установщик обновит её, MSI тоже умеет апгрейд.
3. **При первом запуске** автоматически применятся миграции БД (если они есть в этом релизе), `PRAGMA user_version` стампится в актуальное значение, данные остаются на месте.

### Перенос на другой компьютер

Скопируйте `%APPDATA%\app.taskflow.desktop\data.db` на новый ПК в ту же папку — все задачи появятся. Или используйте экспорт/импорт через JSON.

### Если что-то пошло не так

- Settings → «Диагностика» → «Открыть лог» — увидите, на каком шаге упало.
- Установите ту версию, на которой работало, → «Восстановить из бэкапа» → залейте JSON.
- Откройте [issue](https://github.com/danny-swan/taskflow-app/issues) с логом — починим.

---

## ⌨️ Горячие клавиши

| Клавиша | Действие |
|---|---|
| `1` | Открыть **Задачи** |
| `2` | Открыть **Dashboard** |
| `3` | Открыть **Statistics** |
| `4` | Открыть **Settings** |
| `5` | Открыть **Help** |
| `/` | Фокус в поле поиска |
| `N` | Новая задача |

Хоткеи не срабатывают, когда фокус в текстовом поле.

---

## ⚙️ Стек

| Слой | Технологии |
|---|---|
| Desktop runtime | **Tauri 2.x** (Rust) с NSIS / MSI / Portable сборками |
| Frontend | **React 18** + TypeScript + Vite |
| Стилизация | Tailwind CSS, 4 темы |
| State | **zustand** |
| База данных | **SQLite** через `tauri-plugin-sql` (desktop) / `sql.js` (web-режим) |
| Drag-and-drop | `@dnd-kit` |
| Графики | `recharts` |
| Иконки | `lucide-react` |
| Экспорт/импорт | JSON, CSV (papaparse), XLSX (sheetjs) |

---

## 🛠 Сборка из исходников

### Локальная сборка (Windows)

Нужны:
- **Node.js 20+**
- **Rust** (stable) с target `x86_64-pc-windows-msvc`
- **Microsoft C++ Build Tools** (входят в Visual Studio Build Tools)

```powershell
git clone https://github.com/danny-swan/taskflow-app.git
cd taskflow-app
npm ci
npm run tauri:dev     # запуск с hot-reload
npm run tauri:build   # сборка .exe / .msi / portable в src-tauri\target\release\bundle\
```

### Сборка через GitHub Actions (без локального окружения)

Workflow `.github/workflows/build.yml` запускается:
- автоматически при пуше тега `v*` (например, `v0.8.12`) — создаёт релиз с артефактами;
- вручную через **Actions → Build TaskFlow for Windows → Run workflow**.

Что собирается:
1. NSIS `*_x64-setup.exe` (per-user, без админских прав)
2. MSI `*_x64_ru-RU.msi` и `*_x64_en-US.msi`
3. Portable `taskflow.exe`

Полная сборка ~9 минут на `windows-latest`.

### Релиз новой версии

```powershell
# 1. Поднимите версию в package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
# 2. Добавьте запись в src/data/changelog.ts
git commit -am "v0.X.Y: краткое описание"
git tag v0.X.Y
git push && git push origin v0.X.Y
# CI соберёт артефакты и опубликует релиз
```

---

## 🗺 Roadmap

- [ ] **v0.8.13** — Toast снизу по центру, markdown-чекбоксы в комментариях с прогрессом на карточке, шаблоны задач (с пользовательскими шаблонами и кнопкой «Из шаблона»).
- [ ] **v0.9.x** — Подзадачи как отдельные сущности, повторяющиеся задачи, напоминания, канбан картчоки, календарь.
- [ ] **v1.0** — Стабильный API экспорта, плагины, синхронизация через WebDAV/S3, мобильная версия, авторизация и пользователи.

Полная история изменений: [`src/data/changelog.ts`](src/data/changelog.ts) или Help в приложении.

---

## 🤝 Обратная связь и баги

- [Issues](https://github.com/danny-swan/taskflow-app/issues) — баги и предложения.
- [Discussions](https://github.com/danny-swan/taskflow-app/discussions) — обсуждение фич.

При баге, пожалуйста, приложите содержимое `taskflow.log` (Settings → «Диагностика» → «Открыть лог»).

---

## 📄 Лицензия

MIT — см. [LICENSE](LICENSE). Можно свободно использовать в личных и коммерческих целях, форкать и модифицировать.

---

<a id="english"></a>

# TaskFlow (English)

**Local-first Kanban task manager for Windows. No cloud, no accounts, no subscriptions.**

[Download v0.8.12](https://github.com/danny-swan/taskflow-app/releases/latest) · [Features](#-features) · [Installation](#-installation-1) · [Upgrading](#-upgrading-without-data-loss)

---

## 📋 What is it

**TaskFlow** is a desktop task management app in a Kanban style. Everything is stored locally in a SQLite file on your computer — no data leaves your machine, no signup, no internet required. Suitable for personal todos, work processes and small projects where privacy matters.

Built with **Tauri 2** (Rust + React), ~5 MB installer, instant startup, **no admin rights required**.

> Themes: 🌞 Light · 🌚 Dark · 🩸 Akatsuki · 🍃 Konoha · UI languages: 🇷🇺 RU / 🇬🇧 EN

---

## ✨ Features

### Tasks & Kanban
- 🎯 **Kanban board** with fully customisable status columns (create, rename, recolour, hide).
- 🖱 **Drag-and-drop** between columns and within a column — order is persisted.
- 🏷 **Tags** with colours and emoji, filtering and search by tag and text.
- 📅 Start date, finish date, auto-calculated duration.
- ✅ **One-click complete** — marks the task as "Done" with a timestamp.
- ↩️ **Undo for destructive actions** (v0.8.12) — "Undo" toast after delete, archive or completion.
- 🚦 **Status behaviours:** normal, pinned-top, archive-on-enter, technical (e.g. "Deleted").

### Analytics
- 📊 **Dashboard** — overview: totals, active, completed, by tag.
- 📈 **Statistics** — weekly/monthly charts, completion trends, breakdown by tag and status (recharts).
- 🔍 Full-text search over title and comments.

### Data & durability
- 💾 **Backups** — one-click JSON export of the whole DB, one-click import.
- 📁 **Custom DB location** — put `data.db` on OneDrive/Dropbox/network share for multi-PC sync.
- 🔄 **Automatic DB migrations** (v0.8.12) — `PRAGMA user_version`, no data loss across upgrades.
- 📝 **Logging** (v0.8.12) — `taskflow.log` with rotation, accessible from Settings → Diagnostics.

### UX
- 🎨 **4 themes:** Light, Dark, Akatsuki, Konoha.
- 🌐 **2 UI languages:** Russian and English.
- 💬 Random quote in the header (a curated set per theme and language).
- ⌨️ **Hotkeys:** `1`–`5` for navigation, `/` to focus search, `N` for new task.
- 🎓 **Welcome tour** (v0.8.12) — 5-step intro for new users, restart from Help.

---

## 📦 Installation

All builds **do not require admin rights** and work on locked-down corporate PCs.

| File | Size | When to choose |
|---|---|---|
| [**TaskFlow_0.8.12_x64-setup.exe**](https://github.com/danny-swan/taskflow-app/releases/download/v0.8.12/TaskFlow_0.8.12_x64-setup.exe) | 4.8 MB | ✅ **Recommended** — NSIS installer, installs to `%LOCALAPPDATA%\Programs\TaskFlow`, creates Start menu shortcut, upgrades cleanly over an older version |
| [TaskFlow_0.8.12_x64_en-US.msi](https://github.com/danny-swan/taskflow-app/releases/download/v0.8.12/TaskFlow_0.8.12_x64_en-US.msi) | 6.3 MB | MSI, English installer UI |
| [TaskFlow_0.8.12_x64_ru-RU.msi](https://github.com/danny-swan/taskflow-app/releases/download/v0.8.12/TaskFlow_0.8.12_x64_ru-RU.msi) | 6.3 MB | MSI, Russian installer UI |
| [taskflow.exe](https://github.com/danny-swan/taskflow-app/releases/download/v0.8.12/taskflow.exe) | 15.4 MB | **Portable** — just run, no install |

> **Antivirus may flag the unsigned `.exe`** — this is expected for open-source apps without a commercial code-signing certificate. Whitelist or build from source (see below).

---

## 🔄 Upgrading without data loss

Your database and settings live **separately** from the executable, so upgrades **never lose data**.

### Data location

```
%APPDATA%\app.taskflow.desktop\
├── data.db          ← all tasks, statuses, tags, settings
└── taskflow.log     ← application log (since v0.8.12)
```

Open Explorer → paste `%APPDATA%\app.taskflow.desktop` into the address bar.

### Correct upgrade flow

1. **Make a backup.** Settings → Backup → Create backup. Keep `taskflow-backup-YYYY-MM-DD.json` somewhere safe.
2. **Run the new installer on top of the old version.** No need to uninstall — NSIS upgrades in place, so does MSI.
3. **On first launch** any pending DB migrations are applied automatically, `PRAGMA user_version` advances, data stays intact.

### Moving to another computer

Copy `%APPDATA%\app.taskflow.desktop\data.db` to the same folder on the new PC — all your tasks appear there. Or use JSON export/import.

### If something breaks

- Settings → Diagnostics → Open log — see where it failed.
- Install the previous working version → "Restore from backup" → load your JSON.
- Open an [issue](https://github.com/danny-swan/taskflow-app/issues) with the log attached.

---

## ⌨️ Hotkeys

| Key | Action |
|---|---|
| `1` | Open **Tasks** |
| `2` | Open **Dashboard** |
| `3` | Open **Statistics** |
| `4` | Open **Settings** |
| `5` | Open **Help** |
| `/` | Focus the search box |
| `N` | New task |

Hotkeys are disabled when a text field is focused.

---

## 🛠 Building from source

### Local build (Windows)

Requirements:
- **Node.js 20+**
- **Rust** (stable) with `x86_64-pc-windows-msvc` target
- **Microsoft C++ Build Tools** (included in Visual Studio Build Tools)

```powershell
git clone https://github.com/danny-swan/taskflow-app.git
cd taskflow-app
npm ci
npm run tauri:dev     # hot-reload dev mode
npm run tauri:build   # build .exe / .msi / portable into src-tauri\target\release\bundle\
```

### Build via GitHub Actions (no local toolchain)

Workflow `.github/workflows/build.yml` runs:
- automatically on `v*` tag push (e.g. `v0.8.12`) — creates a release with artifacts;
- manually via **Actions → Build TaskFlow for Windows → Run workflow**.

Outputs:
1. NSIS `*_x64-setup.exe` (per-user, no admin)
2. MSI `*_x64_ru-RU.msi` and `*_x64_en-US.msi`
3. Portable `taskflow.exe`

Full build ~9 minutes on `windows-latest`.

---

## ⚙️ Tech stack

| Layer | Technology |
|---|---|
| Desktop runtime | **Tauri 2.x** (Rust) with NSIS / MSI / Portable bundles |
| Frontend | **React 18** + TypeScript + Vite |
| Styling | Tailwind CSS, 4 themes |
| State | **zustand** |
| Database | **SQLite** via `tauri-plugin-sql` (desktop) / `sql.js` (web mode) |
| Drag-and-drop | `@dnd-kit` |
| Charts | `recharts` |
| Icons | `lucide-react` |
| Import/export | JSON, CSV (papaparse), XLSX (sheetjs) |

---

## 🗺 Roadmap

- [ ] **v0.8.13** — Toast at bottom-center, Markdown checkboxes inside comments with a card progress indicator, user-defined task templates with a "From template" button.
- [ ] **v0.9.x** — Subtasks as first-class entities, recurring tasks, reminders.
- [ ] **v1.0** — Stable export API, plugins, WebDAV/S3 sync.

Full changelog: [`src/data/changelog.ts`](src/data/changelog.ts) or in-app Help.

---

## 🤝 Feedback

- [Issues](https://github.com/danny-swan/taskflow-app/issues) — bugs and feature requests.
- [Discussions](https://github.com/danny-swan/taskflow-app/discussions) — feature discussion.

When reporting a bug, please attach `taskflow.log` (Settings → Diagnostics → Open log).

---

## 📄 License

MIT — see [LICENSE](LICENSE). Free for personal and commercial use, fork and modify freely.
