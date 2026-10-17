//! Window geometry: restored in `setup` before the window becomes visible and
//! captured when the session is saved or the window closes. The frontend needs
//! no window permissions for this.

use crate::session::WindowGeometry;
use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// A monitor's work area in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Minimum part of the title bar (px) that must lie on a monitor so the window
/// can still be grabbed – otherwise the saved position is ignored.
const GRAB_MARGIN: i64 = 48;
const MIN_WIDTH: u32 = 640;
const MIN_HEIGHT: u32 = 400;

/// True if the top strip of the window intersects one of the monitors.
pub fn is_reachable(geom: &WindowGeometry, monitors: &[MonitorRect]) -> bool {
    let (wx, wy, ww) = (i64::from(geom.x), i64::from(geom.y), i64::from(geom.width));
    monitors.iter().any(|m| {
        let (mx, my) = (i64::from(m.x), i64::from(m.y));
        let (mr, mb) = (mx + i64::from(m.width), my + i64::from(m.height));
        let overlap_x = (wx + ww).min(mr) - wx.max(mx);
        wy >= my - GRAB_MARGIN / 2 && wy + GRAB_MARGIN / 2 <= mb && overlap_x >= GRAB_MARGIN
    })
}

/// Applies a saved geometry (size always, position only if reachable).
pub fn restore<R: Runtime>(window: &WebviewWindow<R>, geom: &WindowGeometry) {
    let size = PhysicalSize::new(geom.width.max(MIN_WIDTH), geom.height.max(MIN_HEIGHT));
    let _ = window.set_size(size);
    let monitors: Vec<MonitorRect> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| MonitorRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect();
    if is_reachable(geom, &monitors) {
        let _ = window.set_position(PhysicalPosition::new(geom.x, geom.y));
    }
    if geom.maximized {
        let _ = window.maximize();
    }
}

/// Current geometry. While maximised or minimised the last normal geometry
/// (`previous`) is kept, so un-maximising after a restart restores it.
pub fn capture<R: Runtime>(
    window: &WebviewWindow<R>,
    previous: Option<WindowGeometry>,
) -> Option<WindowGeometry> {
    let maximized = window.is_maximized().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if maximized || minimized {
        return previous
            .map(|p| WindowGeometry { maximized, ..p })
            .or_else(|| current(window).map(|g| WindowGeometry { maximized, ..g }));
    }
    current(window)
}

fn current<R: Runtime>(window: &WebviewWindow<R>) -> Option<WindowGeometry> {
    let pos = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(WindowGeometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geom(x: i32, y: i32) -> WindowGeometry {
        WindowGeometry {
            x,
            y,
            width: 1000,
            height: 700,
            maximized: false,
        }
    }

    const MAIN: MonitorRect = MonitorRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };
    const LEFT: MonitorRect = MonitorRect {
        x: -2560,
        y: -200,
        width: 2560,
        height: 1440,
    };

    #[test]
    fn position_on_a_monitor_is_reachable() {
        assert!(is_reachable(&geom(100, 100), &[MAIN]));
        assert!(is_reachable(&geom(-2000, -100), &[MAIN, LEFT]));
        // mostly off to the right, but 100 px of the title bar are still visible
        assert!(is_reachable(&geom(1820, 10), &[MAIN]));
    }

    #[test]
    fn position_off_all_monitors_is_not_reachable() {
        assert!(
            !is_reachable(&geom(-2000, -100), &[MAIN]),
            "monitor was unplugged"
        );
        assert!(
            !is_reachable(&geom(100, 1070), &[MAIN]),
            "title bar below the screen"
        );
        assert!(
            !is_reachable(&geom(1900, 10), &[MAIN]),
            "only 20 px visible"
        );
        assert!(!is_reachable(&geom(100, 100), &[]));
    }
}
