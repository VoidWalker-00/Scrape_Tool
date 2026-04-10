// lib.rs — Tauri entry point for Scrape Tool.
//
// Spawns `node server.js` as a background sidecar on launch.
// The Tauri webview connects to http://localhost:3000 (Express).
// On app exit, the Node process is killed via the stored Child handle.
//
// In development (cargo tauri dev): beforeDevCommand starts server.js — no spawn needed.
// In production (cargo tauri build): server.js is bundled next to the binary and spawned here.

#[cfg(not(debug_assertions))]
use std::path::PathBuf;
#[cfg(not(debug_assertions))]
use std::process::{Command, Child};
#[cfg(not(debug_assertions))]
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Release only: spawn Node sidecar. Dev mode uses beforeDevCommand instead.
    #[cfg(not(debug_assertions))]
    let child_ref = {
        let server_js: PathBuf = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(PathBuf::from))
            .map(|dir| dir.join("server.js"))
            .filter(|p| p.exists())
            .unwrap_or_else(|| PathBuf::from("server.js"));

        let working_dir = server_js
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));

        let child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
        match Command::new("node").arg(&server_js).current_dir(&working_dir).spawn() {
            Ok(proc) => *child.lock().unwrap() = Some(proc),
            Err(e)   => eprintln!("Failed to start Express server: {e}"),
        }
        child
    };

    tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(move |_app, event| {
            #[cfg(not(debug_assertions))]
            if let tauri::RunEvent::Exit = event {
                if let Some(mut c) = child_ref.lock().unwrap().take() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
            }
            #[cfg(debug_assertions)]
            let _ = event;
        });
}
