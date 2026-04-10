// lib.rs — Tauri entry point for Scrape Tool.
//
// Spawns `node server.js` as a background process on launch.
// The Tauri webview connects to http://localhost:3000 (Express).
// On app exit, the Node process is killed via the stored Child handle.
//
// In development (cargo tauri dev): beforeDevCommand starts server.js — no spawn needed.
// In production (cargo tauri build): server.js is bundled into the app resources and
// spawned here.
//
// Path layout in a packaged install (e.g. .deb on Linux):
//   resource_dir()          → /usr/lib/Scrape Tool/
//   resource_dir()/_up_/    → /usr/lib/Scrape Tool/_up_/   (Tauri maps "../" → "_up_/")
//   server.js               → /usr/lib/Scrape Tool/_up_/server.js
//   app_data_dir()          → ~/.local/share/com.scrape-tool.app/
//
// SCRAPE_TOOL_DATA is set to app_data_dir() so server.js and logging.js write
// Data/ and Logs/ to a writable location instead of the read-only install prefix.

use tauri::Manager;
#[cfg(not(debug_assertions))]
use std::process::{Command, Child};
#[cfg(not(debug_assertions))]
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(debug_assertions))]
    let child_ref: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    #[cfg(not(debug_assertions))]
    let child_for_setup = child_ref.clone();

    tauri::Builder::default()
        .setup(move |app| {
            #[cfg(not(debug_assertions))]
            {
                // Resolve the bundled server.js — Tauri maps "../foo" → "_up_/foo"
                let resource_dir = app.path().resource_dir()
                    .expect("could not resolve resource dir");
                let server_js = resource_dir.join("_up_").join("server.js");

                if !server_js.exists() {
                    eprintln!("server.js not found at {:?}", server_js);
                    return Ok(());
                }

                // Writable directory for Data/ and Logs/
                let data_dir = app.path().app_data_dir()
                    .expect("could not resolve app data dir");
                std::fs::create_dir_all(&data_dir).ok();

                match Command::new("node")
                    .arg(&server_js)
                    .current_dir(&data_dir)
                    .env("SCRAPE_TOOL_DATA", &data_dir)
                    .spawn()
                {
                    Ok(proc) => *child_for_setup.lock().unwrap() = Some(proc),
                    Err(e)   => eprintln!("Failed to start Express server: {e}"),
                }
            }
            Ok(())
        })
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
