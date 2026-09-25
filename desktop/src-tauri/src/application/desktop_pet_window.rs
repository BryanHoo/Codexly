use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use tauri::Emitter;
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[cfg(not(target_os = "macos"))]
use super::desktop_pet_commands::{DesktopPetPosition, DesktopPetRuntime};
use super::error::AppError;
use crate::infrastructure::app_storage;

pub(super) const DESKTOP_PET_EVENT: &str = "desktop-pet://state";
#[cfg(not(target_os = "macos"))]
const DESKTOP_PET_MOVED_EVENT: &str = "desktop-pet://moved";
pub(super) const DESKTOP_PET_LABEL: &str = "desktop-pet";
const DESKTOP_PET_POSITION_KEY: &str = "codeagent.desktop-pet-position";
const PET_WINDOW_MARGIN: i32 = 24;
const PET_WINDOW_SIZE_LOGICAL: f64 = 96.0;
const PET_BUBBLE_WIDTH_LOGICAL: f64 = 192.0;
const PET_BUBBLE_MAX_HEIGHT_LOGICAL: f64 = 320.0;
const PET_BUBBLE_GAP_LOGICAL: f64 = 8.0;

#[derive(Clone, Copy, Debug, PartialEq)]
struct DesktopPetOverlayLayout {
    pet_offset_x: f64,
    pet_offset_y: f64,
    window_height: f64,
    window_width: f64,
}

fn desktop_pet_overlay_layout(bubble_height: f64) -> Option<DesktopPetOverlayLayout> {
    if !bubble_height.is_finite() || !(0.0..=PET_BUBBLE_MAX_HEIGHT_LOGICAL).contains(&bubble_height)
    {
        return None;
    }
    let has_bubbles = bubble_height > 0.0;
    let window_width = if has_bubbles {
        PET_BUBBLE_WIDTH_LOGICAL
    } else {
        PET_WINDOW_SIZE_LOGICAL
    };
    let window_height = PET_WINDOW_SIZE_LOGICAL
        + if has_bubbles {
            PET_BUBBLE_GAP_LOGICAL + bubble_height.ceil()
        } else {
            0.0
        };
    Some(DesktopPetOverlayLayout {
        pet_offset_x: window_width - PET_WINDOW_SIZE_LOGICAL,
        pet_offset_y: window_height - PET_WINDOW_SIZE_LOGICAL,
        window_height,
        window_width,
    })
}

fn physical_pet_size(scale: f64) -> PhysicalSize<u32> {
    let side = (PET_WINDOW_SIZE_LOGICAL * scale).round() as u32;
    PhysicalSize::new(side, side)
}

fn pet_position_from_window(
    window_position: PhysicalPosition<i32>,
    window_size: PhysicalSize<u32>,
    scale: f64,
) -> PhysicalPosition<i32> {
    let pet_size = physical_pet_size(scale);
    PhysicalPosition::new(
        window_position.x.saturating_add(
            i32::try_from(window_size.width.saturating_sub(pet_size.width)).unwrap_or(i32::MAX),
        ),
        window_position.y.saturating_add(
            i32::try_from(window_size.height.saturating_sub(pet_size.height)).unwrap_or(i32::MAX),
        ),
    )
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredPetPosition {
    version: u8,
    x: i32,
    y: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct MonitorBounds {
    height: u32,
    width: u32,
    x: i32,
    y: i32,
}

impl MonitorBounds {
    const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            height,
            width,
            x,
            y,
        }
    }

    fn contains_window(self, position: PhysicalPosition<i32>, size: PhysicalSize<u32>) -> bool {
        let right = i64::from(position.x) + i64::from(size.width);
        let bottom = i64::from(position.y) + i64::from(size.height);
        position.x >= self.x
            && position.y >= self.y
            && right <= i64::from(self.x) + i64::from(self.width)
            && bottom <= i64::from(self.y) + i64::from(self.height)
    }

    fn contains_point(self, position: PhysicalPosition<i32>) -> bool {
        position.x >= self.x
            && position.y >= self.y
            && i64::from(position.x) < i64::from(self.x) + i64::from(self.width)
            && i64::from(position.y) < i64::from(self.y) + i64::from(self.height)
    }

    fn safe_corner(self, size: PhysicalSize<u32>) -> PhysicalPosition<i32> {
        let width = i32::try_from(size.width).unwrap_or(i32::MAX);
        let height = i32::try_from(size.height).unwrap_or(i32::MAX);
        PhysicalPosition {
            x: self.x + i32::try_from(self.width).unwrap_or(i32::MAX) - width - PET_WINDOW_MARGIN,
            y: self.y + i32::try_from(self.height).unwrap_or(i32::MAX) - height - PET_WINDOW_MARGIN,
        }
    }

    fn clamp_window(
        self,
        position: PhysicalPosition<i32>,
        size: PhysicalSize<u32>,
    ) -> PhysicalPosition<i32> {
        let width = i32::try_from(size.width).unwrap_or(i32::MAX);
        let height = i32::try_from(size.height).unwrap_or(i32::MAX);
        let max_x = self
            .x
            .saturating_add(i32::try_from(self.width).unwrap_or(i32::MAX))
            .saturating_sub(width);
        let max_y = self
            .y
            .saturating_add(i32::try_from(self.height).unwrap_or(i32::MAX))
            .saturating_sub(height);
        PhysicalPosition::new(
            position.x.clamp(self.x, max_x.max(self.x)),
            position.y.clamp(self.y, max_y.max(self.y)),
        )
    }
}

pub(super) fn resolve_pet_position(
    saved: Option<PhysicalPosition<i32>>,
    monitors: &[MonitorBounds],
    window_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    if let Some(position) = saved
        && monitors
            .iter()
            .any(|monitor| monitor.contains_window(position, window_size))
    {
        return position;
    }
    monitors.first().copied().map_or(
        PhysicalPosition::new(PET_WINDOW_MARGIN, PET_WINDOW_MARGIN),
        |monitor| monitor.safe_corner(window_size),
    )
}

pub(super) fn move_pet_position(
    current: PhysicalPosition<i32>,
    delta_x: i32,
    delta_y: i32,
    monitors: &[MonitorBounds],
    window_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let target = PhysicalPosition::new(
        current.x.saturating_add(delta_x),
        current.y.saturating_add(delta_y),
    );
    monitors
        .iter()
        .copied()
        .find(|monitor| monitor.contains_window(current, window_size))
        .or_else(|| monitors.first().copied())
        .map_or(target, |monitor| monitor.clamp_window(target, window_size))
}

pub(super) fn drag_pet_position(
    target: PhysicalPosition<i32>,
    monitors: &[MonitorBounds],
    window_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let center = PhysicalPosition::new(
        target
            .x
            .saturating_add(i32::try_from(window_size.width / 2).unwrap_or(i32::MAX)),
        target
            .y
            .saturating_add(i32::try_from(window_size.height / 2).unwrap_or(i32::MAX)),
    );
    if monitors
        .iter()
        .any(|monitor| monitor.contains_point(center))
    {
        return target;
    }
    monitors
        .iter()
        .copied()
        .min_by_key(|monitor| {
            let clamped = monitor.clamp_window(target, window_size);
            let dx = i128::from(target.x) - i128::from(clamped.x);
            let dy = i128::from(target.y) - i128::from(clamped.y);
            dx * dx + dy * dy
        })
        .map_or(target, |monitor| monitor.clamp_window(target, window_size))
}

pub(super) fn monitor_bounds(window: &WebviewWindow) -> Result<Vec<MonitorBounds>, AppError> {
    window
        .available_monitors()
        .map_err(|_| AppError::DesktopPetWindowFailed)
        .map(|monitors| {
            monitors
                .into_iter()
                .map(|monitor| {
                    let area = monitor.work_area();
                    MonitorBounds::new(
                        area.position.x,
                        area.position.y,
                        area.size.width,
                        area.size.height,
                    )
                })
                .collect()
        })
}

pub(super) fn desktop_pet_position(
    window: &WebviewWindow,
) -> Result<PhysicalPosition<i32>, AppError> {
    let window_position = window
        .outer_position()
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    let window_size = window
        .outer_size()
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    let scale = window
        .scale_factor()
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    Ok(pet_position_from_window(
        window_position,
        window_size,
        scale,
    ))
}

pub(super) fn desktop_pet_size(window: &WebviewWindow) -> Result<PhysicalSize<u32>, AppError> {
    window
        .scale_factor()
        .map(physical_pet_size)
        .map_err(|_| AppError::DesktopPetWindowFailed)
}

pub(super) fn set_desktop_pet_position(
    window: &WebviewWindow,
    pet_position: PhysicalPosition<i32>,
) -> Result<(), AppError> {
    let window_size = window
        .outer_size()
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    let pet_size = desktop_pet_size(window)?;
    let position = PhysicalPosition::new(
        pet_position.x.saturating_sub(
            i32::try_from(window_size.width.saturating_sub(pet_size.width)).unwrap_or(i32::MAX),
        ),
        pet_position.y.saturating_sub(
            i32::try_from(window_size.height.saturating_sub(pet_size.height)).unwrap_or(i32::MAX),
        ),
    );
    window
        .set_position(position)
        .map_err(|_| AppError::DesktopPetWindowFailed)
}

pub(super) fn layout_desktop_pet_window(
    window: &WebviewWindow,
    bubble_height: f64,
) -> Result<(), AppError> {
    let layout =
        desktop_pet_overlay_layout(bubble_height).ok_or(AppError::DesktopPetWindowFailed)?;
    let pet_position = desktop_pet_position(window)?;
    window
        .set_size(LogicalSize::new(layout.window_width, layout.window_height))
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    // WebView 尺寸向上扩展时反向平移窗口，保证精灵的屏幕坐标稳定。
    let scale = window
        .scale_factor()
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    window
        .set_position(PhysicalPosition::new(
            pet_position
                .x
                .saturating_sub((layout.pet_offset_x * scale).round() as i32),
            pet_position
                .y
                .saturating_sub((layout.pet_offset_y * scale).round() as i32),
        ))
        .map_err(|_| AppError::DesktopPetWindowFailed)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::FilesystemRequestFailed)
}

async fn read_stored_position(app: &AppHandle) -> Result<Option<PhysicalPosition<i32>>, AppError> {
    let preferences = app_storage::read_preferences(&app_data_dir(app)?)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    Ok(preferences
        .get(DESKTOP_PET_POSITION_KEY)
        .and_then(|value| serde_json::from_str::<StoredPetPosition>(value).ok())
        .filter(|position| position.version == 1)
        .map(|position| PhysicalPosition::new(position.x, position.y)))
}

pub(super) async fn persist_position(
    app: &AppHandle,
    position: PhysicalPosition<i32>,
) -> Result<(), AppError> {
    let value = serde_json::to_string(&StoredPetPosition {
        version: 1,
        x: position.x,
        y: position.y,
    })
    .map_err(|_| AppError::FilesystemRequestFailed)?;
    let mut updates = BTreeMap::new();
    updates.insert(DESKTOP_PET_POSITION_KEY.to_string(), Some(value));
    app_storage::update_preferences(&app_data_dir(app)?, updates)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)
}

pub(super) async fn create_desktop_pet_window(app: &AppHandle) -> Result<WebviewWindow, AppError> {
    let saved_position = read_stored_position(app).await?;
    let window = overlay_window_builder(app)
        .build()
        .map_err(|_| AppError::DesktopPetWindowFailed)?;
    #[cfg(target_os = "macos")]
    super::desktop_pet_panel::configure_desktop_overlay(&window).await?;
    #[cfg(target_os = "windows")]
    desktop_pet_platform::configure_windows_desktop_pet(
        window
            .hwnd()
            .map_err(|_| AppError::DesktopPetWindowFailed)?
            .0 as isize,
    )
    .map_err(|_| AppError::DesktopPetWindowFailed)?;

    // 使用工作区而非整块屏幕，避免首次出现时落到 Dock 或任务栏下方。
    let position = resolve_pet_position(
        saved_position,
        &monitor_bounds(&window)?,
        desktop_pet_size(&window)?,
    );
    set_desktop_pet_position(&window, position)?;
    #[cfg(not(target_os = "macos"))]
    {
        let event_app = app.clone();
        let event_window = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Moved(position) = event {
                let Ok(size) = event_window.outer_size() else {
                    return;
                };
                let Ok(scale) = event_window.scale_factor() else {
                    return;
                };
                let pet_position = pet_position_from_window(*position, size, scale);
                let _ = event_window.emit(
                    DESKTOP_PET_MOVED_EVENT,
                    DesktopPetPosition::from(pet_position),
                );
                event_app
                    .state::<DesktopPetRuntime>()
                    .schedule_position_persist(event_app.clone(), pet_position);
            }
        });
    }
    Ok(window)
}

fn overlay_window_builder<'a>(
    app: &'a AppHandle,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(
        app,
        DESKTOP_PET_LABEL,
        WebviewUrl::App("index.html?window=desktop-pet".into()),
    )
    .title("Codexly Pet")
    .inner_size(PET_WINDOW_SIZE_LOGICAL, PET_WINDOW_SIZE_LOGICAL)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .focused(false)
    .accept_first_mouse(true)
    .visible(false)
}

pub(super) async fn destroy_desktop_pet_window(
    app: &AppHandle,
    label: &str,
) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        return super::desktop_pet_panel::destroy_desktop_overlay(app, label).await;
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window(label) {
            window
                .destroy()
                .map_err(|_| AppError::DesktopPetWindowFailed)?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "desktop_pet_window_tests.rs"]
mod tests;
