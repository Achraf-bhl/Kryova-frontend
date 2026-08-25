//! Kryova desktop shell.
//!
//! Thin on purpose: the application is the Next.js frontend talking to the
//! Kryova backend over HTTP. This crate exists to give that a native window,
//! a taskbar identity and an installer, not to hold product logic.

use tauri::Manager;

/// Where the backend lives. Overridable so a desktop build can point at a
/// remote deployment instead of a local one.
fn api_base_url() -> String {
    std::env::var("KRYOVA_API_URL").unwrap_or_else(|_| "http://localhost:8000/api/v1".into())
}

#[tauri::command]
fn backend_url() -> String {
    api_base_url()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![backend_url])
        .setup(|app| {
            // Surface the window only once it is ready, so the user never sees
            // a white rectangle while the frontend boots.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Kryova");
}
