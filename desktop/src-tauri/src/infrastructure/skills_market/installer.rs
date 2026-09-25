use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::encoding::encode_lower_hex;

use super::{DownloadedSkillArchive, SkillsMarketError, compatibility::is_codex_compatible_skill};

const MAX_FILES: usize = 2_048;
const MAX_UNCOMPRESSED_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub path: String,
    pub version: String,
    pub status: &'static str,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillOrigin {
    version: u8,
    registry: String,
    slug: String,
    owner_handle: String,
    installed_version: String,
    fingerprint: String,
}

pub async fn install_clawhub_archive(
    archive: DownloadedSkillArchive,
    skills_root: PathBuf,
    owner: String,
    slug: String,
    version: String,
) -> Result<InstallResult, SkillsMarketError> {
    tokio::task::spawn_blocking(move || {
        install_sync(archive, &skills_root, &owner, &slug, &version)
    })
    .await
    .map_err(|_| SkillsMarketError::Filesystem)?
}

fn install_sync(
    archive: DownloadedSkillArchive,
    skills_root: &Path,
    owner: &str,
    slug: &str,
    version: &str,
) -> Result<InstallResult, SkillsMarketError> {
    fs::create_dir_all(skills_root).map_err(|_| SkillsMarketError::Filesystem)?;
    let target = skills_root.join(slug);
    let existing = read_origin(&target);
    if target.exists()
        && existing
            .as_ref()
            .is_none_or(|origin| origin.owner_handle != owner || origin.slug != slug)
    {
        return Err(SkillsMarketError::Conflict);
    }
    if target.exists()
        && existing.as_ref().is_none_or(|origin| {
            skill_content_hash(&target)
                .map(|current| current != origin.fingerprint)
                .unwrap_or(true)
        })
    {
        return Err(SkillsMarketError::Conflict);
    }
    if existing
        .as_ref()
        .is_some_and(|origin| origin.installed_version == version)
    {
        return Ok(InstallResult {
            path: target.to_string_lossy().into_owned(),
            version: version.to_owned(),
            status: "current",
        });
    }

    let nonce = format!(
        "{}-{}",
        std::process::id(),
        time::OffsetDateTime::now_utc().unix_timestamp_nanos()
    );
    let staging = skills_root.join(format!(".{slug}.codeagent-{nonce}"));
    let backup = skills_root.join(format!(".{slug}.backup-{nonce}"));
    let extracted = extract_archive(&archive.bytes, &staging, archive.source_path.as_deref())?;
    if let Some(expected) = archive.content_hash.as_deref()
        && skill_content_hash(&extracted)? != expected
    {
        let _ = fs::remove_dir_all(&staging);
        return Err(SkillsMarketError::InvalidArchive);
    }
    let source = fs::read_to_string(extracted.join("SKILL.md"))
        .map_err(|_| SkillsMarketError::InvalidArchive)?;
    if !is_codex_compatible_skill(&source) {
        let _ = fs::remove_dir_all(&staging);
        return Err(SkillsMarketError::Incompatible);
    }
    let fingerprint = skill_content_hash(&extracted)?;
    let metadata = extracted.join(".clawhub");
    fs::create_dir_all(&metadata).map_err(|_| SkillsMarketError::Filesystem)?;
    let origin = SkillOrigin {
        version: 1,
        registry: "https://clawhub.ai".to_owned(),
        slug: slug.to_owned(),
        owner_handle: owner.to_owned(),
        installed_version: version.to_owned(),
        fingerprint,
    };
    fs::write(
        metadata.join("origin.json"),
        serde_json::to_vec_pretty(&origin).map_err(|_| SkillsMarketError::Filesystem)?,
    )
    .map_err(|_| SkillsMarketError::Filesystem)?;

    let had_existing = target.exists();
    if had_existing {
        fs::rename(&target, &backup).map_err(|_| SkillsMarketError::Filesystem)?;
    }
    if let Err(error) = fs::rename(&extracted, &target) {
        if had_existing {
            let _ = fs::rename(&backup, &target);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
            SkillsMarketError::Conflict
        } else {
            SkillsMarketError::Filesystem
        });
    }
    if extracted != staging {
        let _ = fs::remove_dir_all(&staging);
    }
    if had_existing {
        let _ = fs::remove_dir_all(&backup);
    }
    Ok(InstallResult {
        path: target.to_string_lossy().into_owned(),
        version: version.to_owned(),
        status: if had_existing { "updated" } else { "installed" },
    })
}

fn read_origin(target: &Path) -> Option<SkillOrigin> {
    let bytes = fs::read(target.join(".clawhub/origin.json")).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn extract_archive(
    archive: &[u8],
    destination: &Path,
    source_path: Option<&str>,
) -> Result<PathBuf, SkillsMarketError> {
    let source_path = match source_path {
        None => None,
        Some(path) => {
            let path = Path::new(path);
            if !path
                .components()
                .all(|part| matches!(part, std::path::Component::Normal(_)))
            {
                return Err(SkillsMarketError::InvalidArchive);
            }
            Some(path)
        }
    };
    let mut zip =
        ZipArchive::new(Cursor::new(archive)).map_err(|_| SkillsMarketError::InvalidArchive)?;
    if zip.is_empty() || zip.len() > MAX_FILES {
        return Err(SkillsMarketError::InvalidArchive);
    }
    fs::create_dir_all(destination).map_err(|_| SkillsMarketError::Filesystem)?;
    let mut total = 0_u64;
    for index in 0..zip.len() {
        let entry = zip
            .by_index(index)
            .map_err(|_| SkillsMarketError::InvalidArchive)?;
        total = total
            .checked_add(entry.size())
            .ok_or(SkillsMarketError::InvalidArchive)?;
        if total > MAX_UNCOMPRESSED_BYTES
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(SkillsMarketError::InvalidArchive);
        }
        let archive_relative = entry
            .enclosed_name()
            .ok_or(SkillsMarketError::InvalidArchive)?;
        let github_relative = archive_relative.components().skip(1).collect::<PathBuf>();
        let relative = if let Some(source) = source_path {
            let Ok(relative) = github_relative.strip_prefix(source) else {
                continue;
            };
            if relative.as_os_str().is_empty() {
                continue;
            }
            relative.to_path_buf()
        } else {
            archive_relative.to_path_buf()
        };
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output).map_err(|_| SkillsMarketError::Filesystem)?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|_| SkillsMarketError::Filesystem)?;
        }
        let mut file = fs::File::create(output).map_err(|_| SkillsMarketError::Filesystem)?;
        std::io::copy(&mut entry.take(MAX_UNCOMPRESSED_BYTES + 1), &mut file)
            .map_err(|_| SkillsMarketError::Filesystem)?;
    }
    if destination.join("SKILL.md").is_file() {
        return Ok(destination.to_path_buf());
    }
    let entries = fs::read_dir(destination)
        .map_err(|_| SkillsMarketError::Filesystem)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    if entries.len() == 1 && entries[0].path().join("SKILL.md").is_file() {
        return Ok(entries[0].path());
    }
    Err(SkillsMarketError::InvalidArchive)
}

fn skill_content_hash(root: &Path) -> Result<String, SkillsMarketError> {
    fn collect(root: &Path, directory: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                return Err(std::io::Error::other("skill symlink is not allowed"));
            }
            if file_type.is_dir() {
                if directory == root && entry.file_name() == ".clawhub" {
                    continue;
                }
                collect(root, &entry.path(), files)?;
            } else if file_type.is_file() {
                files.push(
                    entry
                        .path()
                        .strip_prefix(root)
                        .unwrap_or(entry.path().as_path())
                        .to_path_buf(),
                );
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    collect(root, root, &mut files).map_err(|_| SkillsMarketError::InvalidArchive)?;
    files.sort();
    let mut combined = Sha256::new();
    for (index, relative) in files.into_iter().enumerate() {
        let bytes =
            fs::read(root.join(&relative)).map_err(|_| SkillsMarketError::InvalidArchive)?;
        let path = relative.to_string_lossy().replace('\\', "/");
        let file_hash = encode_lower_hex(Sha256::digest(&bytes));
        if index > 0 {
            combined.update(b"\n");
        }
        combined.update(path.as_bytes());
        combined.update([0]);
        combined.update(bytes.len().to_string().as_bytes());
        combined.update([0]);
        combined.update(file_hash.as_bytes());
    }
    Ok(encode_lower_hex(combined.finalize()))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use zip::{ZipWriter, write::SimpleFileOptions};

    use super::{
        DownloadedSkillArchive, SkillsMarketError, extract_archive, install_sync,
        skill_content_hash,
    };

    fn archive(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (path, content) in entries {
            writer
                .start_file(path, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn rejects_archive_path_traversal() {
        let root =
            std::env::temp_dir().join(format!("codeagent-skill-test-{}", std::process::id()));
        let result = extract_archive(&archive(&[("../escape", "bad")]), &root, None);
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn extracts_portable_skill_with_wrapped_root() {
        let root =
            std::env::temp_dir().join(format!("codeagent-skill-valid-{}", std::process::id()));
        let bytes = archive(&[(
            "package/SKILL.md",
            "---\nname: review\ndescription: Review code.\n---\n# Review\n",
        )]);
        let skill_root = extract_archive(&bytes, &root, None).unwrap();
        assert_eq!(skill_root, root.join("package"));
        assert!(skill_root.join("SKILL.md").is_file());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn extracts_only_the_verified_github_skill_path() {
        let root =
            std::env::temp_dir().join(format!("codeagent-skill-github-{}", std::process::id()));
        let bytes = archive(&[
            (
                "repo-main/skills/review/SKILL.md",
                "---\nname: review\ndescription: Review code.\n---\n",
            ),
            ("repo-main/README.md", "unrelated"),
        ]);
        let skill_root = extract_archive(&bytes, &root, Some("skills/review")).unwrap();
        assert_eq!(skill_root, root);
        assert!(root.join("SKILL.md").is_file());
        assert!(!root.join("README.md").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_to_overwrite_local_skill_changes() {
        let root =
            std::env::temp_dir().join(format!("codeagent-skill-update-{}", std::process::id()));
        let package = || DownloadedSkillArchive {
            bytes: archive(&[(
                "SKILL.md",
                "---\nname: review\ndescription: Review code.\n---\n",
            )]),
            content_hash: None,
            source_path: None,
        };
        install_sync(package(), &root, "codex", "review", "1.0.0").unwrap();
        std::fs::write(root.join("review/SKILL.md"), "local changes").unwrap();

        let result = install_sync(package(), &root, "codex", "review", "1.1.0");
        assert!(matches!(result, Err(SkillsMarketError::Conflict)));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn matches_clawhub_content_hash_format() {
        let root =
            std::env::temp_dir().join(format!("codeagent-skill-hash-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("SKILL.md"), b"hello\n").unwrap();

        assert_eq!(
            skill_content_hash(&root).unwrap(),
            "4bbbfbca2790e2b4a1e64203fe3bc62399a797bcd8944527f19fe542c6a2e39c"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
