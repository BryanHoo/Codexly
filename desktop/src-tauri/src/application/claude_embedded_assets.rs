use super::error::AppError;
use flate2::read::GzDecoder;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/claude_embedded.rs"));
}

/// Windows 便携 EXE 在私有目录展开压缩资源，版本目录避免覆盖正在执行的文件。
pub async fn prepare(app_data: &Path) -> Result<(PathBuf, PathBuf), AppError> {
    if embedded::BINARY.is_empty() || embedded::HOST.is_empty() {
        return Err(AppError::Claude(
            "Claude runtime resources are missing from this build".into(),
        ));
    }
    let manifest: Value = serde_json::from_str(embedded::MANIFEST)
        .map_err(|error| AppError::Claude(error.to_string()))?;
    let binary_hash = manifest["sha256"]
        .as_str()
        .ok_or_else(|| AppError::Claude("Missing Claude integrity".into()))?
        .to_owned();
    let host_hash = manifest["hostSha256"]
        .as_str()
        .ok_or_else(|| AppError::Claude("Missing Claude host integrity".into()))?
        .to_owned();
    let directory = app_data.join("providers/claude/0.3.300").join(&host_hash);
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&directory).map_err(|error| AppError::Claude(error.to_string()))?;
        let binary = directory.join("claude.exe");
        let host = directory.join("claude-host.exe");
        extract(embedded::BINARY, &binary_hash, &binary)?;
        extract(embedded::HOST, &host_hash, &host)?;
        Ok((binary, host))
    })
    .await
    .map_err(|error| AppError::Claude(error.to_string()))?
}

fn extract(bytes: &[u8], expected: &str, target: &Path) -> Result<(), AppError> {
    let operation = || -> Result<(), Box<dyn std::error::Error>> {
        if target.is_file() {
            let mut file = std::fs::File::open(target)?;
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 65536];
            loop {
                let count = file.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                hash.update(&buffer[..count]);
            }
            if hash
                .finalize()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
                == expected
            {
                return Ok(());
            }
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(target.parent().ok_or("Invalid Claude path")?)?;
        let mut decoder = GzDecoder::new(bytes);
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let count = decoder.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
            temporary.write_all(&buffer[..count])?;
        }
        if hash
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
            != expected
        {
            return Err("Claude resource integrity mismatch".into());
        }
        temporary.as_file().sync_all()?;
        temporary.persist(target)?;
        Ok(())
    };
    operation().map_err(|error| AppError::Claude(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decompresses_verified_resources_and_rejects_wrong_digest() {
        let directory = tempfile::tempdir().unwrap();
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(b"runtime-contract").unwrap();
        let bytes = encoder.finish().unwrap();
        let expected = Sha256::digest(b"runtime-contract")
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let path = directory.path().join("runtime.exe");
        extract(&bytes, &expected, &path).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"runtime-contract");
        assert!(extract(&bytes, "bad-digest", &path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"runtime-contract");
    }
    #[tokio::test]
    async fn unprepared_build_fails_without_creating_partial_runtime() {
        if embedded::BINARY.is_empty() {
            let directory = tempfile::tempdir().unwrap();
            assert!(prepare(directory.path()).await.is_err());
            assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
        }
    }
}
