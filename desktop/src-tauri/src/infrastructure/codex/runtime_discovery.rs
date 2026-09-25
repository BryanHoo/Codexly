use std::{
    env,
    path::{Path, PathBuf},
};

use super::process::SUPPORTED_CODEX_VERSION;

pub(super) fn private_codex_binary_path(app_data: &Path) -> PathBuf {
    app_data
        .join("providers/codex/bin")
        .join(SUPPORTED_CODEX_VERSION)
        .join("bin")
        .join(format!("codex{}", env::consts::EXE_SUFFIX))
}
