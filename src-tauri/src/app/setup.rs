use crate::app::window::open_additional_window_safe;
use crate::util::focus_window_and_webview;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewWindow,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[derive(Debug, PartialEq, Eq)]
enum WindowActivationAction {
    Hide,
    ShowAndFocus,
}

fn activation_action(is_visible: bool, is_focused: bool) -> WindowActivationAction {
    if is_visible && is_focused {
        WindowActivationAction::Hide
    } else {
        WindowActivationAction::ShowAndFocus
    }
}

fn show_and_focus_window(window: &WebviewWindow, _init_fullscreen: bool) {
    let _ = window.unminimize();
    let _ = window.show();
    focus_window_and_webview(window);

    #[cfg(target_os = "linux")]
    if _init_fullscreen && !window.is_fullscreen().unwrap_or(false) {
        let _ = window.set_fullscreen(true);
        focus_window_and_webview(window);
    }
}

fn activate_or_hide_window(window: &WebviewWindow, init_fullscreen: bool) {
    let is_visible = window.is_visible().unwrap_or(false);
    let is_focused = window.is_focused().unwrap_or(false);

    match activation_action(is_visible, is_focused) {
        WindowActivationAction::Hide => {
            let _ = window.hide();
        }
        WindowActivationAction::ShowAndFocus => {
            show_and_focus_window(window, init_fullscreen);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activation_hides_only_when_visible_and_focused() {
        assert_eq!(activation_action(true, true), WindowActivationAction::Hide);
    }

    #[test]
    fn activation_shows_when_visible_but_in_background() {
        assert_eq!(
            activation_action(true, false),
            WindowActivationAction::ShowAndFocus
        );
    }

    #[test]
    fn activation_shows_when_hidden() {
        assert_eq!(
            activation_action(false, false),
            WindowActivationAction::ShowAndFocus
        );
    }
}

pub fn set_system_tray(
    app: &AppHandle,
    show_system_tray: bool,
    tray_icon_path: &str,
    _init_fullscreen: bool,
    allow_multi_window: bool,
) -> tauri::Result<()> {
    if !show_system_tray {
        app.remove_tray_by_id("pake-tray");
        return Ok(());
    }

    let new_window = MenuItemBuilder::with_id("new_window", "New Window").build(app)?;
    let hide_app = MenuItemBuilder::with_id("hide_app", "Hide").build(app)?;
    let show_app = MenuItemBuilder::with_id("show_app", "Show").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = if allow_multi_window {
        MenuBuilder::new(app)
            .items(&[&new_window, &hide_app, &show_app, &quit])
            .build()?
    } else {
        MenuBuilder::new(app)
            .items(&[&hide_app, &show_app, &quit])
            .build()?
    };

    app.app_handle().remove_tray_by_id("pake-tray");

    let mut tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "new_window" => {
                open_additional_window_safe(app);
            }
            "hide_app" => {
                if let Some(window) = app.get_webview_window("pake") {
                    let _ = window.minimize();
                }
            }
            "show_app" => {
                if let Some(window) = app.get_webview_window("pake") {
                    show_and_focus_window(&window, _init_fullscreen);
                }
            }
            "quit" => {
                let _ = app.save_window_state(StateFlags::all());
                app.exit(0);
            }
            _ => (),
        })
        .on_tray_icon_event(move |tray, event| match event {
            TrayIconEvent::Click { button, .. } => {
                if button == tauri::tray::MouseButton::Left {
                    if let Some(window) = tray.app_handle().get_webview_window("pake") {
                        activate_or_hide_window(&window, _init_fullscreen);
                    }
                }
            }
            _ => {}
        });

    let resolved_icon = if tray_icon_path.is_empty() {
        app.default_window_icon().cloned()
    } else {
        tauri::image::Image::from_path(tray_icon_path)
            .ok()
            .or_else(|| app.default_window_icon().cloned())
    };

    if let Some(icon) = resolved_icon {
        tray_builder = tray_builder.icon(icon);
    } else {
        eprintln!("[Pake] No tray icon available; tray will build without an icon.");
    }

    let tray = tray_builder.build(app)?;

    tray.set_icon_as_template(false)?;
    Ok(())
}

pub fn set_global_shortcut(
    app: &AppHandle,
    shortcut: String,
    _init_fullscreen: bool,
) -> tauri::Result<()> {
    if shortcut.is_empty() {
        return Ok(());
    }

    let app_handle = app.clone();
    let shortcut_hotkey = match Shortcut::from_str(&shortcut) {
        Ok(s) => s,
        Err(error) => {
            eprintln!("[Pake] Invalid activation shortcut '{shortcut}': {error}");
            return Ok(());
        }
    };
    let last_triggered = Arc::new(Mutex::new(Instant::now()));

    if let Err(error) = app_handle.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler({
                let last_triggered = Arc::clone(&last_triggered);
                move |app, event, _shortcut| {
                    let Ok(mut last_triggered) = last_triggered.lock() else {
                        return;
                    };
                    if Instant::now().duration_since(*last_triggered) < Duration::from_millis(300) {
                        return;
                    }
                    *last_triggered = Instant::now();

                    if shortcut_hotkey.eq(event) {
                        if let Some(window) = app.get_webview_window("pake") {
                            activate_or_hide_window(&window, _init_fullscreen);
                        }
                    }
                }
            })
            .build(),
    ) {
        eprintln!(
            "[Pake] Failed to register global shortcut plugin '{shortcut}': {error}; continuing without it."
        );
        return Ok(());
    }

    if let Err(error) = app.global_shortcut().register(shortcut_hotkey) {
        eprintln!("[Pake] Failed to bind global shortcut '{shortcut}': {error}");
    }

    Ok(())
}
