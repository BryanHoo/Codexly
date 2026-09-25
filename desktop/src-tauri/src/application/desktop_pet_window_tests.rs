use super::*;

const PET_SIZE: PhysicalSize<u32> = PhysicalSize::new(96, 96);

#[test]
fn restores_a_position_that_is_visible_on_a_secondary_monitor() {
    let monitors = [
        MonitorBounds::new(0, 0, 1920, 1080),
        MonitorBounds::new(-1280, 0, 1280, 1024),
    ];
    assert_eq!(
        resolve_pet_position(Some(PhysicalPosition::new(-640, 400)), &monitors, PET_SIZE,),
        PhysicalPosition::new(-640, 400),
    );
}

#[test]
fn moves_an_offscreen_position_to_the_primary_monitor_safe_corner() {
    assert_eq!(
        resolve_pet_position(
            Some(PhysicalPosition::new(4000, 3000)),
            &[MonitorBounds::new(0, 0, 1920, 1080)],
            PET_SIZE,
        ),
        PhysicalPosition::new(1800, 960),
    );
}

#[test]
fn bubbles_stay_above_the_pet_at_the_top_edge() {
    let layout = desktop_pet_overlay_layout(64.0).unwrap();

    assert_eq!(layout.window_width, 192.0);
    assert_eq!(layout.window_height, 168.0);
    assert_eq!(layout.pet_offset_x, 96.0);
    assert_eq!(layout.pet_offset_y, 72.0);
}

#[test]
fn pet_without_tasks_uses_only_the_sprite_bounds() {
    let layout = desktop_pet_overlay_layout(0.0).unwrap();

    assert_eq!(layout.window_width, 96.0);
    assert_eq!(layout.window_height, 96.0);
    assert_eq!(layout.pet_offset_x, 0.0);
    assert_eq!(layout.pet_offset_y, 0.0);
}

#[test]
fn desktop_drag_crosses_adjacent_monitors_without_clamping_at_the_seam() {
    let monitors = [
        MonitorBounds::new(0, 0, 1920, 1080),
        MonitorBounds::new(1920, 0, 2560, 1440),
    ];
    assert_eq!(
        drag_pet_position(PhysicalPosition::new(1880, 400), &monitors, PET_SIZE),
        PhysicalPosition::new(1880, 400),
    );
}
