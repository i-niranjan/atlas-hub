use serde::Serialize;
use std::path::PathBuf;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

const DAEMON_URL: &str = "http://127.0.0.1:47600";

#[derive(Serialize)]
struct DaemonConnection {
    url: String,
    token: Option<String>,
}

/// The daemon writes its bearer token to Application Support; the webview reads it through here.
#[tauri::command]
fn daemon_connection() -> DaemonConnection {
    let token = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library/Application Support/Atlas/token"))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    DaemonConnection {
        url: std::env::var("ATLAS_DAEMON_URL").unwrap_or_else(|_| DAEMON_URL.to_string()),
        token,
    }
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let ask = MenuItem::with_id(app, "ask", "Ask Atlas…", true, Some("CmdOrCtrl+K"))?;
    let search = MenuItem::with_id(app, "search", "Search", true, Some("CmdOrCtrl+F"))?;
    let review = MenuItem::with_id(app, "review", "Needs Review", true, Some("CmdOrCtrl+Shift+R"))?;
    let superseded = MenuItem::with_id(
        app,
        "toggle-superseded",
        "Show Superseded Entries",
        true,
        Some("CmdOrCtrl+Shift+H"),
    )?;
    let add_project = MenuItem::with_id(app, "add-project", "Track Project Folder…", true, Some("CmdOrCtrl+O"))?;

    let app_menu = Submenu::with_items(
        app,
        "Atlas",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Atlas"), Some(AboutMetadata::default()))?,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file_menu = Submenu::with_items(app, "File", true, &[&add_project])?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&ask, &search, &review, &PredefinedMenuItem::separator(app)?, &superseded],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![daemon_connection])
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("menu", event.id().0.as_str());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Atlas");
}
