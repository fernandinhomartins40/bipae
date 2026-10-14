//! Bipaê Desktop shell (ADR-0012). The UI is the shared React app; Rust hosts the native
//! ports: local SQLite, peripherals (printer, drawer, scale), the Bipaê Conector server and,
//! in signed release builds, the auto-updater.
//!
//! Started with `--connector`, the app runs as the Bipaê Conector only: no window, an icon in
//! the system tray, serving peripherals to the web register on this computer.

mod connector;
mod db;
mod peripherals;

use std::sync::Arc;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

#[derive(Serialize)]
struct PlatformInfo {
    os: &'static str,
    arch: &'static str,
    version: &'static str,
    connector_mode: bool,
    updater: bool,
}

/// Basic information shown in support screens and sent with bug reports.
#[tauri::command]
fn platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        version: env!("CARGO_PKG_VERSION"),
        connector_mode: connector_mode(),
        updater: cfg!(feature = "updater"),
    }
}

fn connector_mode() -> bool {
    std::env::args().any(|a| a == "--connector")
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir o Bipaê", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair do Bipaê Conector", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("Bipaê Conector")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(feature = "updater")]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .manage(db::DbState::default())
        .manage(Arc::new(connector::ConnectorState::default()))
        .setup(|app| {
            connector::start(app.handle().clone());
            if connector_mode() {
                setup_tray(app)?;
                if let Some(window) = app.get_webview_window("main") {
                    window.hide()?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_info,
            db::db_open,
            db::db_run,
            db::db_exec,
            db::db_close,
            peripherals::devices_get_config,
            peripherals::devices_set_config,
            peripherals::devices_list_ports,
            peripherals::devices_print,
            peripherals::devices_open_drawer,
            peripherals::devices_read_scale,
            connector::connector_status,
            connector::connector_new_code,
            connector::connector_revoke
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Bipaê Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_info_reports_package_version() {
        let info = platform_info();
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert!(!info.os.is_empty());
    }
}
