use std::net::TcpListener;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// The Bun backend (server/index.ts, compiled with `bun build --compile`) ships next to
/// the app binary as a Tauri external binary. It talks to Zalo; the webview talks to it.
struct Backend(Mutex<Option<Child>>);

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(17789)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let port = free_port();
            let token = uuid::Uuid::new_v4().simple().to_string();
            let data = app.path().app_data_dir()?;
            let exe = std::env::current_exe()?;
            let server = exe.with_file_name("zalo-lite-server");

            let child = Command::new(&server)
                .env("ZL_PORT", port.to_string())
                .env("ZL_TOKEN", &token)
                .env("ZL_DATA", &data)
                .spawn()
                .map_err(|e| format!("cannot start backend at {}: {e}", server.display()))?;
            app.manage(Backend(Mutex::new(Some(child))));

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Zalo Lite")
                .inner_size(1180.0, 760.0)
                .min_inner_size(760.0, 520.0)
                .initialization_script(&format!("window.__ZL__={{port:{port},token:\"{token}\"}};"))
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Backend>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
