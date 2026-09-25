use std::path::{Component, Path, PathBuf};

use serde::Deserialize;

const ACTIVE_MANIFEST_LIMIT: u64 = 16 * 1024;

#[derive(Deserialize)]
pub(super) struct ActiveCodexRuntime {
    pub(super) path: PathBuf,
    pub(super) version: String,
}

pub(super) fn read_active_codex_runtime(app_data: &Path) -> Option<ActiveCodexRuntime> {
    let manifest_path = app_data.join("providers/codex/active.json");
    let metadata = std::fs::metadata(&manifest_path).ok()?;
    if !metadata.is_file() || metadata.len() > ACTIVE_MANIFEST_LIMIT {
        return None;
    }

    let manifest =
        serde_json::from_slice::<ActiveCodexRuntime>(&std::fs::read(manifest_path).ok()?).ok()?;
    if manifest.version.len() > 64 || !private_runtime_path_is_valid(app_data, &manifest.path) {
        return None;
    }
    Some(manifest)
}

fn private_runtime_path_is_valid(app_data: &Path, binary_path: &Path) -> bool {
    if !binary_path.is_absolute()
        || binary_path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
        || !binary_path.is_file()
    {
        return false;
    }

    // active.json 只能恢复应用私有目录中的可执行文件，不能成为任意程序启动入口。
    let Ok(bin_root) = app_data.join("providers/codex/bin").canonicalize() else {
        return false;
    };
    binary_path
        .canonicalize()
        .is_ok_and(|canonical| canonical.starts_with(bin_root))
}
