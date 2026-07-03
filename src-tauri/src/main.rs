// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
// PolyForm Noncommercial License 1.0.0
// https://polyformproject.org/licenses/noncommercial/1.0.0/
//
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
struct DbConfig {
    custom_path: Option<String>,
}

struct AppState {
    db_path: Mutex<Option<String>>,
}

/// Returns the current DB path (custom or default).
/// Default: `{app_config_dir}/data.db`
#[tauri::command]
fn get_db_path(state: tauri::State<AppState>, app: tauri::AppHandle) -> String {
    let lock = state.db_path.lock().unwrap();
    if let Some(ref p) = *lock {
        return p.clone();
    }
    // Build default path
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    let _ = std::fs::create_dir_all(&config_dir);
    config_dir
        .join("data.db")
        .to_string_lossy()
        .into_owned()
}

/// v0.8.9/0.8.10: Открывает системный файл-менеджер на папке текущей БД.
/// Принимает путь к файлу или папке. Если путь похож на файл (есть
/// расширение или имя содержит точку), всегда берём родителя. Это надёжно
/// работает, даже если сам файл ещё не существует.
#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    use std::path::{Path, PathBuf};
    // Нормализуем разделители (на Windows допускаются и `/`, и `\`)
    let normalized = path.replace('/', std::path::MAIN_SEPARATOR_STR);
    let p = Path::new(&normalized);

    let looks_like_file = p
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.contains('.'))
        .unwrap_or(false);

    let dir: PathBuf = if p.is_file() || (looks_like_file && p.parent().is_some()) {
        p.parent().map(|x| x.to_path_buf()).unwrap_or_else(|| p.to_path_buf())
    } else {
        p.to_path_buf()
    };
    // Гарантируем, что папка существует (если БД ещё не создана).
    let _ = std::fs::create_dir_all(&dir);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(dir.as_os_str())
            .spawn()
            .map_err(|e| format!("explorer failed: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(dir.as_os_str())
            .spawn()
            .map_err(|e| format!("open failed: {}", e))?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(dir.as_os_str())
            .spawn()
            .map_err(|e| format!("xdg-open failed: {}", e))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("unsupported platform".into())
}

/// Persists a custom DB path. Pass empty string to reset to default.
///
/// v0.8.10: При смене пути дополнительно копируем существующую БД из
/// старого расположения в новое (если в новом ещё нет файла, а в старом —
/// есть). Старый файл оставляем на месте — на случай отката. Также
/// гарантируем, что папка назначения существует.
#[tauri::command]
fn set_db_path(path: String, state: tauri::State<AppState>, app: tauri::AppHandle) -> Result<(), String> {
    use std::path::PathBuf;

    let new_path_opt = if path.is_empty() {
        None
    } else {
        // Нормализуем `/` → системный разделитель
        Some(path.replace('/', std::path::MAIN_SEPARATOR_STR))
    };

    // Текущий путь (до смены) — для возможного копирования.
    let old_path: String = {
        let lock = state.db_path.lock().unwrap();
        if let Some(ref p) = *lock {
            p.clone()
        } else {
            // Default path
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            config_dir.join("data.db").to_string_lossy().into_owned()
        }
    };

    // Save config to disk
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&config_dir);
    let cfg_file = config_dir.join("taskflow_config.json");
    let cfg = DbConfig { custom_path: new_path_opt.clone() };
    let json = serde_json::to_string(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&cfg_file, json).map_err(|e| e.to_string())?;

    // Copy existing DB to new location if needed.
    if let Some(ref new_p) = new_path_opt {
        let new_pb = PathBuf::from(new_p);
        if let Some(parent) = new_pb.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let old_pb = PathBuf::from(&old_path);
        if old_pb.exists() && !new_pb.exists() && old_pb != new_pb {
            // best-effort copy; не критично, если упадёт (просто будет новая пустая БД)
            let _ = std::fs::copy(&old_pb, &new_pb);
            // также копируем WAL/SHM сайдкары если есть
            for ext in ["-wal", "-shm"] {
                let old_side = PathBuf::from(format!("{}{}", old_path, ext));
                let new_side = PathBuf::from(format!("{}{}", new_p, ext));
                if old_side.exists() && !new_side.exists() {
                    let _ = std::fs::copy(&old_side, &new_side);
                }
            }
        }
    }

    *state.db_path.lock().unwrap() = new_path_opt;
    Ok(())
}

/// v0.8.10: Перезапускает приложение — используется после смены пути
/// БД, чтобы plugin-sql переподключился к новому файлу.
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// v0.8.11: Создаёт бинарную резервную копию файла БД в той же папке.
/// Исходный файл: текущий db_path (либо кастомный, либо дефолтный).
/// Результат: <тот же файл>.backup (просто перезаписывается при каждом вызове).
///
/// Примечание: SQLite может держать WAL/SHM-файлы открытыми. На Windows std::fs::copy
/// обычно работает даже для файлов, открытых SQLite в режиме WAL (shared read).
/// Если копия сделана в момент активной транзакции, SQLite восстановит состояние при открытии.
#[tauri::command]
fn backup_db(state: tauri::State<AppState>, app: tauri::AppHandle) -> Result<String, String> {
    use std::path::PathBuf;
    let current_path = {
        let lock = state.db_path.lock().unwrap();
        if let Some(ref p) = *lock {
            p.clone()
        } else {
            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|e| e.to_string())?;
            config_dir.join("data.db").to_string_lossy().into_owned()
        }
    };
    let src = PathBuf::from(&current_path);
    if !src.exists() {
        return Err(format!("файл БД не найден: {}", current_path));
    }
    let backup_path = format!("{}.backup", current_path);
    let dst = PathBuf::from(&backup_path);
    // Гарантируем, что папка существует (обычно да, но на всякий случай).
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::copy(&src, &dst).map_err(|e| format!("копирование не удалось: {}", e))?;
    Ok(backup_path)
}

/// v0.8.11: Возвращает ожидаемый путь к backup-файлу (без проверки существования) —
/// используется UI для отображения пути резервной копии.
#[tauri::command]
fn get_backup_path(state: tauri::State<AppState>, app: tauri::AppHandle) -> String {
    let current_path = {
        let lock = state.db_path.lock().unwrap();
        if let Some(ref p) = *lock {
            p.clone()
        } else {
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            config_dir.join("data.db").to_string_lossy().into_owned()
        }
    };
    format!("{}.backup", current_path)
}

/// v0.8.12: returns the directory where logs are stored (= directory of
/// current DB path). This keeps logs co-located with user data so they
/// move together if the user changes the DB path.
fn current_log_path(state: &tauri::State<AppState>, app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    let current_path = {
        let lock = state.db_path.lock().unwrap();
        if let Some(ref p) = *lock {
            p.clone()
        } else {
            let config_dir = app.path().app_config_dir().ok()?;
            config_dir.join("data.db").to_string_lossy().into_owned()
        }
    };
    let db_path = PathBuf::from(&current_path);
    let dir = db_path.parent()?.to_path_buf();
    Some(dir.join("taskflow.log"))
}

/// v0.8.12: append a single line to taskflow.log next to data.db.
/// Rotates when file exceeds 1 MB (taskflow.log -> taskflow.log.old).
/// Best-effort: errors are returned as strings but the frontend swallows them
/// to avoid logging loops.
#[tauri::command]
fn log_line(line: String, state: tauri::State<AppState>, app: tauri::AppHandle) -> Result<(), String> {
    use std::io::Write;
    let log_path = current_log_path(&state, &app).ok_or("could not determine log path")?;
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Rotate if > 1 MB
    const MAX_LOG_BYTES: u64 = 1_048_576;
    if let Ok(meta) = std::fs::metadata(&log_path) {
        if meta.len() > MAX_LOG_BYTES {
            let rotated = log_path.with_extension("log.old");
            let _ = std::fs::rename(&log_path, &rotated);
        }
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("open log failed: {}", e))?;
    writeln!(file, "{}", line).map_err(|e| format!("write log failed: {}", e))?;
    Ok(())
}

/// v0.8.12: returns the path to taskflow.log (without checking existence).
#[tauri::command]
fn get_log_path(state: tauri::State<AppState>, app: tauri::AppHandle) -> String {
    current_log_path(&state, &app)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// v0.8.12: truncates the current log file. Also removes the rotated .log.old.
#[tauri::command]
fn clear_log(state: tauri::State<AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let log_path = current_log_path(&state, &app).ok_or("could not determine log path")?;
    if log_path.exists() {
        std::fs::write(&log_path, b"").map_err(|e| format!("truncate failed: {}", e))?;
    }
    let rotated = log_path.with_extension("log.old");
    if rotated.exists() {
        let _ = std::fs::remove_file(&rotated);
    }
    Ok(())
}

fn load_saved_db_path(app: &tauri::AppHandle) -> Option<String> {
    let config_dir = app.path().app_config_dir().ok()?;
    let cfg_file = config_dir.join("taskflow_config.json");
    let json = std::fs::read_to_string(&cfg_file).ok()?;
    let cfg: DbConfig = serde_json::from_str(&json).ok()?;
    cfg.custom_path
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let saved = load_saved_db_path(&app.handle());
            app.manage(AppState { db_path: Mutex::new(saved) });
            Ok(())
        })
        // v0.8.11: автоматическая резервная копия при закрытии окна (best-effort, не блокирует выход).
        // При любой ошибке копирования просто логируем и даём приложению закрыться.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_handle = window.app_handle().clone();
                let state: tauri::State<AppState> = app_handle.state();
                let current_path: String = {
                    let lock = state.db_path.lock().unwrap();
                    if let Some(ref p) = *lock {
                        p.clone()
                    } else {
                        match app_handle.path().app_config_dir() {
                            Ok(dir) => dir.join("data.db").to_string_lossy().into_owned(),
                            Err(_) => return,
                        }
                    }
                };
                let src = std::path::PathBuf::from(&current_path);
                if src.exists() {
                    let backup_path = format!("{}.backup", current_path);
                    if let Err(e) = std::fs::copy(&src, &backup_path) {
                        eprintln!("[v0.8.11] backup-on-close failed: {}", e);
                    } else {
                        eprintln!("[v0.8.11] backup saved: {}", backup_path);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_db_path,
            set_db_path,
            open_in_explorer,
            restart_app,
            backup_db,
            get_backup_path,
            log_line,
            get_log_path,
            clear_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    let _ = app;
}
