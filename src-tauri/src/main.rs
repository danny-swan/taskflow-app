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

/// v0.8.9: Открывает системный файл-менеджер на папке текущей БД.
/// Принимает путь к файлу или папке; выбирает родительскую для файла.
#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    use std::path::Path;
    let p = Path::new(&path);
    let dir = if p.is_file() {
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
#[tauri::command]
fn set_db_path(path: String, state: tauri::State<AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let new_path = if path.is_empty() { None } else { Some(path.clone()) };

    // Save config to disk
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&config_dir);
    let cfg_file = config_dir.join("taskflow_config.json");
    let cfg = DbConfig { custom_path: new_path.clone() };
    let json = serde_json::to_string(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&cfg_file, json).map_err(|e| e.to_string())?;

    *state.db_path.lock().unwrap() = new_path;
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
        .setup(|app| {
            let saved = load_saved_db_path(&app.handle());
            app.manage(AppState { db_path: Mutex::new(saved) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_db_path, set_db_path, open_in_explorer])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    let _ = app;
}
