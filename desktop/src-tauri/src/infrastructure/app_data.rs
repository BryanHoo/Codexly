use std::{io, path::PathBuf};
use tauri::{AppHandle, Manager, Runtime};

#[path = "app_data_migration.rs"]
mod migration;

/// 所有持久业务数据共用用户主目录；不随 Codex 配置、安装位置或当前工作目录变化。
pub fn directory<R: Runtime>(app: &AppHandle<R>) -> io::Result<PathBuf> {
    app.path()
        .home_dir()
        .map(|home| home.join(".codexly"))
        .map_err(io::Error::other)
}

pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> io::Result<()> {
    let home = app.path().home_dir().map_err(io::Error::other)?;
    let codex_home = std::env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map_or_else(|| home.join(".codex"), PathBuf::from);
    let sources = [
        codex_home.join("codexly"),
        home.join(".codex/codexly"),
        app.path().app_data_dir().map_err(io::Error::other)?,
    ];
    migration::prepare(&directory(app)?, &sources)
}
