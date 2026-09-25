use std::{
    collections::{BTreeMap, HashSet},
    path::{Component, Path},
};

use serde::Deserialize;
use tokio::fs;

use super::pet_commands::{
    CustomAnimationSpec, PetAssetRecord, PetFrame, stable_asset_id_for, webp_dimensions,
};

const MAX_MANIFEST_BYTES: u64 = 64 * 1_024;
const MAX_CUSTOM_ASSET_BYTES: u64 = 16 * 1_024 * 1_024;
const MAX_FRAMES: usize = 256;
const MAX_ANIMATION_FRAMES: usize = 512;
const MAX_FPS: f64 = 60.0;
const DEFAULT_FRAME: PetFrame = PetFrame {
    columns: 8,
    height: 208,
    rows: 9,
    width: 192,
};
const DEFAULT_ANIMATIONS: [&str; 14] = [
    "bounce",
    "failed",
    "idle",
    "jumping",
    "move_left",
    "move_right",
    "review",
    "running",
    "running-left",
    "running-right",
    "sad",
    "waiting",
    "wave",
    "waving",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomPetManifest {
    animations: Option<BTreeMap<String, CustomAnimationSpec>>,
    description: Option<String>,
    display_name: Option<String>,
    frame: Option<PetFrame>,
    id: Option<String>,
    spritesheet_path: Option<String>,
}

pub(super) async fn scan_custom_pets(codex_home: &Path) -> Vec<PetAssetRecord> {
    let preferred = scan_root(codex_home, "pets", "pet.json", "custom").await;
    let preferred_folders = preferred
        .iter()
        .filter_map(|record| record.id.strip_prefix("custom:"))
        .map(str::to_owned)
        .collect::<HashSet<_>>();
    let legacy = scan_root(codex_home, "avatars", "avatar.json", "legacy")
        .await
        .into_iter()
        .filter(|record| {
            record
                .id
                .strip_prefix("custom:")
                .is_none_or(|folder| !preferred_folders.contains(folder))
        });
    preferred.into_iter().chain(legacy).collect()
}

async fn scan_root(
    codex_home: &Path,
    root_name: &str,
    manifest_name: &str,
    source: &'static str,
) -> Vec<PetAssetRecord> {
    let root = codex_home.join(root_name);
    let Ok(mut entries) = fs::read_dir(&root).await else {
        return Vec::new();
    };
    let mut directories = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Ok(file_type) = entry.file_type().await else {
            continue;
        };
        let Some(folder) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if file_type.is_dir() && !folder.is_empty() {
            directories.push((folder, entry.path()));
        }
    }
    directories.sort_by(|left, right| left.0.cmp(&right.0));

    let mut records = Vec::new();
    for (folder, directory) in directories {
        if let Some(record) = load_custom_pet(&directory, &folder, manifest_name, source).await {
            records.push(record);
        }
    }
    records
}

async fn load_custom_pet(
    directory: &Path,
    folder: &str,
    manifest_name: &str,
    source: &'static str,
) -> Option<PetAssetRecord> {
    let base = fs::canonicalize(directory).await.ok()?;
    let manifest_path = base.join(manifest_name);
    let metadata = fs::metadata(&manifest_path).await.ok()?;
    if !metadata.is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return None;
    }
    let raw = fs::read(&manifest_path).await.ok()?;
    let manifest: CustomPetManifest = serde_json::from_slice(&raw).ok()?;
    let spritesheet = normalized(manifest.spritesheet_path.as_deref())
        .unwrap_or_else(|| "spritesheet.webp".to_owned());
    let relative = Path::new(&spritesheet);
    // 自定义清单只能引用自身目录内的相对文件，避免软链接或 `..` 越过宠物资源边界。
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return None;
    }
    let asset = fs::canonicalize(base.join(relative)).await.ok()?;
    if !asset.starts_with(&base) {
        return None;
    }
    let metadata = fs::metadata(&asset).await.ok()?;
    if !metadata.is_file() || metadata.len() > MAX_CUSTOM_ASSET_BYTES {
        return None;
    }
    let bytes = fs::read(&asset).await.ok()?;
    let (image_width, image_height) = webp_dimensions(&bytes)?;
    let frame = manifest.frame.unwrap_or(DEFAULT_FRAME);
    let frame_count = validate_frame(frame, image_width, image_height)?;
    let animations = manifest.animations.unwrap_or_default();
    // 动画进入 WebView 前一次性校验帧索引、帧率和回退目标，渲染循环无需重复防御。
    validate_animations(&animations, frame_count)?;
    let display_name = normalized(manifest.display_name.as_deref())
        .or_else(|| normalized(manifest.id.as_deref()))
        .unwrap_or_else(|| folder.to_owned());

    Some(PetAssetRecord {
        animations: Some(animations),
        asset_id: stable_asset_id_for(&format!("{source}:{folder}")),
        asset_path: Some(asset.to_string_lossy().into_owned()),
        availability: "ready",
        description: normalized(manifest.description.as_deref()),
        display_name: Some(display_name),
        frame: Some(frame),
        id: format!("custom:{folder}"),
        source,
    })
}

fn validate_frame(frame: PetFrame, image_width: u32, image_height: u32) -> Option<usize> {
    if frame.columns == 0 || frame.rows == 0 || frame.width == 0 || frame.height == 0 {
        return None;
    }
    let frame_count = frame.columns.checked_mul(frame.rows)?;
    let width = frame
        .width
        .checked_mul(u32::try_from(frame.columns).ok()?)?;
    let height = frame.height.checked_mul(u32::try_from(frame.rows).ok()?)?;
    (frame_count <= MAX_FRAMES && width == image_width && height == image_height)
        .then_some(frame_count)
}

fn validate_animations(
    animations: &BTreeMap<String, CustomAnimationSpec>,
    frame_count: usize,
) -> Option<()> {
    let names = DEFAULT_ANIMATIONS
        .into_iter()
        .chain(animations.keys().map(String::as_str))
        .collect::<HashSet<_>>();
    for (name, animation) in animations {
        let fps = animation.fps.unwrap_or(8.0);
        let fallback =
            normalized(animation.fallback.as_deref()).unwrap_or_else(|| "idle".to_owned());
        if name.trim().is_empty()
            || animation.frames.is_empty()
            || animation.frames.len() > MAX_ANIMATION_FRAMES
            || animation.frames.iter().any(|index| *index >= frame_count)
            || !fps.is_finite()
            || !(0.0 < fps && fps <= MAX_FPS)
            || !names.contains(fallback.as_str())
        {
            return None;
        }
    }
    Some(())
}

fn normalized(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;
    use tokio::fs;

    use super::scan_custom_pets;

    #[tokio::test]
    async fn preferred_custom_pet_should_override_legacy_folder() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("codeagent-pets-{}-{suffix}", std::process::id()));
        for (directory, manifest, name) in [
            ("avatars/chef", "avatar.json", "Legacy Chef"),
            ("pets/chef", "pet.json", "Chef"),
        ] {
            let path = root.join(directory);
            fs::create_dir_all(&path).await.unwrap();
            fs::write(
                path.join(manifest),
                serde_json::to_vec(&json!({"displayName": name})).unwrap(),
            )
            .await
            .unwrap();
            fs::write(path.join("spritesheet.webp"), extended_webp(1_536, 1_872))
                .await
                .unwrap();
        }

        let records = scan_custom_pets(&root).await;
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].display_name.as_deref(), Some("Chef"));
        assert_eq!(records[0].source, "custom");
        fs::remove_dir_all(&root).await.unwrap();
    }

    fn extended_webp(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"RIFF\x16\0\0\0WEBPVP8X\x0a\0\0\0".to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        for value in [width - 1, height - 1] {
            bytes.extend_from_slice(&[value as u8, (value >> 8) as u8, (value >> 16) as u8]);
        }
        bytes
    }
}
