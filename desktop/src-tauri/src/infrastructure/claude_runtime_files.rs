use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::Path,
};
const MAX_UNPACKED_BYTES: u64 = 512 * 1024 * 1024;

pub(super) fn verified(path: &Path, expected: &str) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let Ok(count) = file.read(&mut buffer) else {
            return false;
        };
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    digest(hash) == expected
}
fn digest(hash: Sha256) -> String {
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
/// 只展开清单指定的可执行文件；跳过元数据，拒绝软链接和超大文件。
pub(super) fn extract(
    archive: &Path,
    target: &Path,
    expected: &str,
    host: bool,
) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut decoder = GzDecoder::new(file).take(MAX_UNPACKED_BYTES + 1);
    if host {
        return publish(&mut decoder, target, expected);
    }
    let mut archive = tar::Archive::new(decoder);
    let name = target.file_name().ok_or("Invalid Claude executable path")?;
    let expected_path = Path::new("package").join(name);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        if entry.path().map_err(|e| e.to_string())? != expected_path {
            continue;
        }
        if !entry.header().entry_type().is_file() || entry.size() > MAX_UNPACKED_BYTES {
            return Err("Invalid Claude executable in archive".into());
        }
        return publish(&mut entry, target, expected);
    }
    Err("Claude executable is missing from archive".into())
}
/// 写入临时文件时同步计算摘要，校验完成后原子替换，避免半下载文件成为可执行依赖。
pub(super) fn publish(reader: &mut impl Read, target: &Path, expected: &str) -> Result<(), String> {
    let operation = || -> Result<(), Box<dyn std::error::Error>> {
        let mut temporary =
            tempfile::NamedTempFile::new_in(target.parent().ok_or("Invalid Claude path")?)?;
        let mut hash = Sha256::new();
        let mut total = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            total += count as u64;
            if total > MAX_UNPACKED_BYTES {
                return Err("Claude executable exceeds size limit".into());
            }
            hash.update(&buffer[..count]);
            temporary.write_all(&buffer[..count])?;
        }
        if digest(hash) != expected {
            return Err("Claude executable integrity mismatch".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .as_file()
                .set_permissions(std::fs::Permissions::from_mode(0o755))?;
        }
        temporary.as_file().sync_all()?;
        temporary.persist(target)?;
        Ok(())
    };
    let mut operation = operation;
    operation().map_err(|e| e.to_string())
}

/// 复用内置资源时代已安装的相同 CLI，避免首次升级重新下载约百兆依赖。
/// Windows 旧目录多一层宿主摘要；只检查有界数量的私有版本目录。
pub(super) fn legacy_binary(root: &Path, name: &str, expected: &str) -> Option<std::path::PathBuf> {
    let direct = root.join(name);
    if verified(&direct, expected) {
        return Some(direct);
    }
    for entry in std::fs::read_dir(root).ok()?.take(32).flatten() {
        let name_hex = entry.file_name();
        let Some(name_hex) = name_hex.to_str() else {
            continue;
        };
        if name_hex.len() != 64 || !name_hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            continue;
        }
        let candidate = entry.path().join(name);
        if verified(&candidate, expected) {
            return Some(candidate);
        }
    }
    None
}
