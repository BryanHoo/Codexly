#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    desktop_pet_platform::prepare_linux_window_backend();
    #[cfg(windows)]
    windows_process_platform::initialize_hidden_console();
    codeagent_lib::run();
}
