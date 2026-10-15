//! 为系统外链启动提供轻量的 Linux 内核识别。

/// 判断当前进程是否运行在 Windows Subsystem for Linux。
pub fn is_wsl() -> bool {
    #[cfg(target_os = "linux")]
    {
        use std::sync::OnceLock;

        static RESULT: OnceLock<bool> = OnceLock::new();
        // 内核标识在进程生命周期内固定；仅首次访问读取，失败时按原生系统处理。
        *RESULT.get_or_init(|| {
            ["/proc/sys/kernel/osrelease", "/proc/version"]
                .into_iter()
                .filter_map(|path| std::fs::read_to_string(path).ok())
                .any(|value| is_microsoft_kernel(&value))
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

#[cfg(any(target_os = "linux", test))]
fn is_microsoft_kernel(value: &str) -> bool {
    value
        .as_bytes()
        .windows(b"microsoft".len())
        .any(|part| part.eq_ignore_ascii_case(b"microsoft"))
}

#[cfg(test)]
mod tests {
    use super::is_microsoft_kernel;

    #[test]
    fn recognizes_both_kernel_identifiers_without_case_sensitivity() {
        for value in [
            "4.4.0-19041-Microsoft\n",
            "5.15.90.1-microsoft-standard-WSL2\n",
            "Linux version 4.4.0 (Microsoft@Microsoft.com)",
        ] {
            assert!(is_microsoft_kernel(value), "{value}");
        }
    }

    #[test]
    fn native_or_missing_kernel_information_is_not_wsl() {
        for value in [
            "",
            "Linux version 6.8.0-45-generic (Ubuntu)",
            "Darwin 25.0.0",
        ] {
            assert!(!is_microsoft_kernel(value), "{value}");
        }
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn non_linux_hosts_are_not_wsl() {
        assert!(!super::is_wsl());
    }
}
