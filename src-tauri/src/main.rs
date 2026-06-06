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
        .setup(|app| {
            let saved = load_saved_db_path(&app.handle());
            app.manage(AppState { db_path: Mutex::new(saved) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_db_path, set_db_path, open_in_explorer, restart_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    let _ = app;
}
