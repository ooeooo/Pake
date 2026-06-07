#[cfg_attr(mobile, tauri::mobile_entry_point)]
mod app;
mod util;

use tauri::Manager;
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_window_state::Builder as WindowStatePlugin;
use tauri_plugin_window_state::StateFlags;

#[cfg(target_os = "macos")]
use std::time::Duration;

const WINDOW_SHOW_DELAY: u64 = 50;

use app::{
    invoke::{
        clear_cache_and_restart, clear_dock_badge, download_file, increment_dock_badge,
        send_notification, set_dock_badge, set_dock_badge_label, update_theme_mode,
    },
    setup::{set_global_shortcut, set_system_tray},
    window::{open_additional_window_safe, set_window, MultiWindowState},
};
use util::{
    focus_window_and_webview, get_pake_config, started_from_auto_start, AUTO_START_HIDDEN_ARG,
};

fn sync_auto_start(app: &tauri::AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        match manager.is_enabled() {
            Ok(true) => manager.disable(),
            Ok(false) => Ok(()),
            Err(error) => Err(error),
        }
    };

    if let Err(error) = result {
        eprintln!("[Pake] Failed to sync auto start setting: {error}");
    }
}

pub fn run_app() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    let (pake_config, tauri_config) = get_pake_config();
    let tauri_app = tauri::Builder::default();

    let show_system_tray = pake_config.show_system_tray();
    let hide_on_close = pake_config.windows[0].hide_on_close;
    let activation_shortcut = pake_config.windows[0].activation_shortcut.clone();
    let init_fullscreen = pake_config.windows[0].fullscreen;
    let start_to_tray = pake_config.windows[0].start_to_tray && show_system_tray; // Only valid when tray is enabled
    let start_hidden = start_to_tray || started_from_auto_start();
    let multi_instance = pake_config.multi_instance;
    let multi_window = pake_config.multi_window;
    let auto_start = pake_config.auto_start;
    let _enable_find = pake_config.windows[0].enable_find;

    let window_state_plugin = WindowStatePlugin::default()
        .with_state_flags(if init_fullscreen {
            StateFlags::FULLSCREEN
        } else {
            // Prevent flickering on the first open.
            StateFlags::all() & !StateFlags::VISIBLE
        })
        .build();

    #[allow(deprecated)]
    let mut app_builder = tauri_app
        .plugin(window_state_plugin)
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTO_START_HIDDEN_ARG]),
        ))
        .plugin(tauri_plugin_opener::init()); // Add this

    // Only add single instance plugin if multiple instances are not allowed
    if !multi_instance {
        app_builder = app_builder.plugin(tauri_plugin_single_instance::init(
            move |app, _args, _cwd| {
                if multi_window {
                    open_additional_window_safe(app);
                } else if let Some(window) = app.get_webview_window("pake") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    focus_window_and_webview(&window);
                }
            },
        ));
    }

    app_builder
        .invoke_handler(tauri::generate_handler![
            download_file,
            send_notification,
            increment_dock_badge,
            set_dock_badge,
            set_dock_badge_label,
            clear_dock_badge,
            update_theme_mode,
            clear_cache_and_restart,
        ])
        .setup(move |app| {
            app.manage(MultiWindowState::new(
                pake_config.clone(),
                tauri_config.clone(),
            ));

            // --- Menu Construction Start ---
            #[cfg(target_os = "macos")]
            {
                app::menu::set_app_menu(app.app_handle(), multi_window, _enable_find)?;

                // Event Handling for Custom Menu Item
                app.on_menu_event(move |app_handle, event| {
                    app::menu::handle_menu_click(app_handle, event.id().as_ref());
                });
            }
            // --- Menu Construction End ---

            let window = set_window(app.app_handle(), &pake_config, &tauri_config)?;
            set_system_tray(
                app.app_handle(),
                show_system_tray,
                &pake_config.system_tray_path,
                init_fullscreen,
                multi_window,
            )?;
            set_global_shortcut(app.app_handle(), activation_shortcut, init_fullscreen)?;
            sync_auto_start(app.app_handle(), auto_start);

            // Show window after state restoration to prevent position flashing
            // Unless tray/autostart asks for a hidden launch.
            if !start_hidden {
                let window_clone = window.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_millis(WINDOW_SHOW_DELAY)).await;
                    let _ = window_clone.show();

                    // Fixed: Linux fullscreen issue with virtual keyboard
                    #[cfg(target_os = "linux")]
                    {
                        if init_fullscreen {
                            let _ = window_clone.set_fullscreen(true);
                            // Ensure webview maintains focus for input after fullscreen
                            focus_window_and_webview(&window_clone);
                        } else {
                            // Fix: Ubuntu 24.04/GNOME window buttons non-functional until resize (#1122)
                            // The window manager needs time to process the MapWindow event before
                            // accepting focus requests. Without this, decorations remain non-interactive.
                            tokio::time::sleep(tokio::time::Duration::from_millis(30)).await;
                            focus_window_and_webview(&window_clone);
                        }
                    }
                });
            }

            Ok(())
        })
        .on_window_event(move |_window, _event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                if hide_on_close && _window.label() == "pake" {
                    // Hide window when hide_on_close is enabled (regardless of tray status)
                    let window = _window.clone();
                    tauri::async_runtime::spawn(async move {
                        #[cfg(target_os = "macos")]
                        {
                            if window.is_fullscreen().unwrap_or(false) {
                                let _ = window.set_fullscreen(false);
                                tokio::time::sleep(Duration::from_millis(900)).await;
                            }
                        }
                        #[cfg(target_os = "linux")]
                        {
                            if window.is_fullscreen().unwrap_or(false) {
                                let _ = window.set_fullscreen(false);
                                // Restore focus after exiting fullscreen to fix input issues
                                let _ = window.set_focus();
                            }
                        }
                        // On macOS, directly hide without minimize to avoid duplicate Dock icons
                        #[cfg(not(target_os = "macos"))]
                        let _ = window.minimize();
                        let _ = window.hide();
                    });
                    api.prevent_close();
                }
                // If hide_on_close is false, allow normal close behavior
                // This lets tauri-plugin-window-state save the window position and size
            }
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("[Pake] Fatal error while building Tauri application: {error}");
            std::process::exit(1);
        })
        .run(|_app, _event| {
            // Handle macOS dock icon click to reopen hidden window
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = _event
            {
                if !has_visible_windows {
                    if let Some(window) = _app.get_webview_window("pake") {
                        let _ = window.show();
                        focus_window_and_webview(&window);
                    }
                }
            }
        });
}

pub fn run() {
    run_app()
}
