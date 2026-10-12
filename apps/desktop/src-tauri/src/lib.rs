//! Bipaê Desktop shell (ADR-0012). The UI is the shared React app; Rust hosts the native
//! ports. Peripheral drivers (ESC/POS, scale, drawer, TEF, PKCS#11) and the Conector mode
//! are added in Phase 2 as Tauri commands behind the same port interfaces.

mod db;

use serde::Serialize;

#[derive(Serialize)]
struct PlatformInfo {
    os: &'static str,
    arch: &'static str,
    version: &'static str,
}

/// Basic information shown in support screens and sent with bug reports.
#[tauri::command]
fn platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(db::DbState::default())
        .invoke_handler(tauri::generate_handler![
            platform_info,
            db::db_open,
            db::db_run,
            db::db_exec,
            db::db_close
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
