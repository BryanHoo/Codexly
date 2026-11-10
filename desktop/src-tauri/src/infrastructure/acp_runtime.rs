use std::path::{Component, Path, PathBuf};
use tokio::io::AsyncReadExt;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    platform: String,
    arch: String,
    host: Host,
    engines: Engines,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Host {
    path: String,
    protocol_version: u32,
}

#[derive(serde::Deserialize)]
struct Engines {
    codex: Engine,
    claude: Engine,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Engine {
    version: String,
    entrypoint: String,
    sdk_version: Option<String>,
}

fn local_path(value: &str) -> bool {
    !value.is_empty()
        && !value.contains(['\\', ':', '\0'])
        && !value.split('/').any(|part| matches!(part, "" | "." | ".."))
        && Path::new(value)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

/// 关于页只读取有界元数据，不启动宿主、不读取原生配置、不哈希签名后的大型程序。
/// Ok(None) 仅表示旧资源布局，损坏的新清单返回错误，不能显示旧版本掩盖安装问题。
async fn read_manifest(resources: &Path) -> Result<Option<Manifest>, ()> {
    const MAX_MANIFEST_BYTES: u64 = 128 * 1024;
    let file = match tokio::fs::File::open(resources.join("manifest.json")).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    let mut bytes = Vec::new();
    file.take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| ())?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(());
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| ())?;
    // 切换前的旧发行资源仍可使用原版本入口；只识别已知旧清单形状。
    if value.get("host").is_none()
        && value.get("engines").is_none()
        && value.get("schemaVersion").and_then(|value| value.as_u64()) == Some(1)
        && value
            .get("codexVersion")
            .and_then(|value| value.as_str())
            .is_some()
    {
        return Ok(None);
    }
    let manifest: Manifest = serde_json::from_value(value).map_err(|_| ())?;
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        _ => return Err(()),
    };
    if manifest.schema_version != 1
        || manifest.platform != platform
        || manifest.arch != arch
        || manifest.host.protocol_version != 1
        || !local_path(&manifest.host.path)
    {
        return Err(());
    }
    for entry in [&manifest.engines.codex, &manifest.engines.claude] {
        if !local_path(&entry.entrypoint) || semver::Version::parse(&entry.version).is_err() {
            return Err(());
        }
    }
    semver::Version::parse(manifest.engines.claude.sdk_version.as_deref().ok_or(())?)
        .map_err(|_| ())?;
    Ok(Some(manifest))
}

pub(crate) async fn bundled_version(resources: &Path, engine: &str) -> Result<Option<String>, ()> {
    let Some(manifest) = read_manifest(resources).await? else {
        return Ok(None);
    };
    match engine {
        "codex" => Ok(Some(manifest.engines.codex.version)),
        "claude" => Ok(Some(manifest.engines.claude.version)),
        _ => Err(()),
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AcpRuntimePaths {
    pub host: PathBuf,
    pub codex: PathBuf,
    pub claude: PathBuf,
}

async fn controlled_executable(root: &Path, relative: &str) -> Result<PathBuf, &'static str> {
    if !local_path(relative) {
        return Err("Invalid ACP runtime path");
    }
    let path = root.join(relative);
    let metadata = tokio::fs::symlink_metadata(&path)
        .await
        .map_err(|_| "ACP runtime missing")?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("Invalid ACP executable");
    }
    let resolved = tokio::fs::canonicalize(path)
        .await
        .map_err(|_| "Invalid ACP executable")?;
    if !resolved.starts_with(root) {
        return Err("ACP executable escaped resources");
    }
    Ok(resolved)
}

#[derive(Default)]
pub(crate) struct AcpRuntimeManager {
    prepared: tokio::sync::Mutex<Option<(PathBuf, AcpRuntimePaths)>>,
}
impl AcpRuntimeManager {
    pub async fn prepare(&self, resources: &Path) -> Result<AcpRuntimePaths, &'static str> {
        let root = tokio::fs::canonicalize(resources)
            .await
            .map_err(|_| "ACP resources missing")?;
        let mut prepared = self.prepared.lock().await;
        if let Some((previous, paths)) = prepared.as_ref() {
            if previous != &root {
                return Err("ACP resources changed");
            }
            return Ok(paths.clone());
        }
        let manifest = read_manifest(&root)
            .await
            .map_err(|_| "Invalid ACP manifest")?
            .ok_or("ACP runtime is not installed")?;
        // 签名可能修改 Mach-O 字节；只校验安装路径和完整性条件，不重扫大文件摘要。
        let paths = AcpRuntimePaths {
            host: controlled_executable(&root, &manifest.host.path).await?,
            codex: controlled_executable(&root, &manifest.engines.codex.entrypoint).await?,
            claude: controlled_executable(&root, &manifest.engines.claude.entrypoint).await?,
        };
        *prepared = Some((root, paths.clone()));
        Ok(paths)
    }
}

#[cfg(test)]
#[path = "acp_runtime_tests.rs"]
mod tests;
