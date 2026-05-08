# TaskFlow — Windows Desktop App

Менеджер задач со SQLite-хранилищем, drag-and-drop, дашбордом и тёмной/светлой/Akatsuki/Konoha темами.

Сборка Windows-приложения происходит автоматически через GitHub Actions: вам не нужны ни Rust, ни Node на компьютере — всё собирается в облаке, вы скачиваете готовый `.exe`.

---

## 🚀 Быстрый старт: получить `.exe` за 10 минут

### Шаг 1. Загрузите проект в свой репозиторий

```powershell
# Клонируйте свой пустой репозиторий
git clone https://github.com/<ВАШ-ЛОГИН>/<ВАШ-РЕПО>.git
cd <ВАШ-РЕПО>

# Распакуйте содержимое taskflow_v0.6.zip в эту папку
# (важно: скопируйте ВСЁ содержимое архива, включая скрытую папку .github)

# Зафиксируйте файлы
git add .
git commit -m "TaskFlow v0.6 — initial commit"
git push origin main
```

### Шаг 2. Запустите сборку через тег

```powershell
git tag v0.6.0
git push origin v0.6.0
```

После этого GitHub Actions автоматически:
1. Запустит сборку на `windows-latest` (~8–10 минут)
2. Соберёт три варианта установщика
3. Создаст релиз в разделе **Releases** вашего репозитория

### Шаг 3. Скачайте готовый файл

Откройте: `https://github.com/<ВАШ-ЛОГИН>/<ВАШ-РЕПО>/releases/tag/v0.6.0`

Вы увидите три файла:

| Файл | Что это | Когда выбирать |
|---|---|---|
| `TaskFlow_0.6.0_x64-setup.exe` | **NSIS-установщик (per-user)** | ✅ Рекомендуется для рабочего ПК без прав админа |
| `TaskFlow_0.6.0_x64_en-US.msi` | MSI-установщик | Если нужен корпоративный формат |
| `taskflow.exe` | **Portable** (просто запускайте) | Если не хотите ничего устанавливать вообще |

> Все три варианта **не требуют прав администратора**. NSIS-установщик ставит приложение в `%LOCALAPPDATA%\Programs\TaskFlow`, данные хранятся в `%APPDATA%\TaskFlow\data.db`.

---

## 📁 Где хранятся данные

- **База задач:** `%APPDATA%\TaskFlow\data.db` (SQLite)
- **Настройки:** `%APPDATA%\TaskFlow\config.json`

Перенести данные на другой компьютер можно простым копированием папки `%APPDATA%\TaskFlow`.

---

## 🛠 Как работает CI

`.github/workflows/build.yml` запускается:
- автоматически при пуше тега `v*` (например, `v0.6.0`, `v0.7.1`)
- вручную через вкладку **Actions → Build Windows → Run workflow**

Шаги:
1. Установка Node 20 + Rust (stable, target `x86_64-pc-windows-msvc`)
2. `npm ci`
3. `npm run tauri:build -- --target x86_64-pc-windows-msvc`
4. Загрузка артефактов (NSIS, MSI, Portable)
5. Создание GitHub Release (только для тегов `v*`)

---

## 💻 Локальная разработка (опционально)

Для запуска и сборки локально нужны:
- Node.js 20+
- Rust (stable) с компонентом `x86_64-pc-windows-msvc`
- Microsoft C++ Build Tools

```powershell
npm ci
npm run tauri:dev      # запуск с hot-reload
npm run tauri:build    # локальная сборка .exe
```

---

## 🆕 Новый релиз

Чтобы выпустить, например, v0.7.0:

```powershell
# Внесите изменения, измените "version" в src-tauri/tauri.conf.json и package.json
git add .
git commit -m "v0.7.0"
git tag v0.7.0
git push origin main
git push origin v0.7.0
```

GitHub Actions сам соберёт и опубликует новый релиз.

---

## ⚙️ Стек

- **Frontend:** Vite + React 18 + TypeScript + Tailwind
- **State:** zustand
- **DB:** sql.js (web) / tauri-plugin-sql (desktop, готов к подключению)
- **DnD:** @dnd-kit
- **Charts:** recharts
- **Icons:** lucide-react
- **Desktop:** Tauri 2.0 + NSIS (per-user installMode)
