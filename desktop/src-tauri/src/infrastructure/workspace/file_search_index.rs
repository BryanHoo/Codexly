use std::{cmp::Ordering, path::Path, sync::Arc};

use ignore::WalkBuilder;
use tokio_util::sync::CancellationToken;

use super::{
    file_search::{FileSearchEntry, MAX_SEARCH_RESULTS},
    path_guard::{WorkspaceError, relative_string},
};

pub(super) const MAX_INDEX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug)]
pub(super) struct IndexedFile {
    pub lower_path: String,
    pub name: String,
    pub path: String,
}

impl IndexedFile {
    pub fn retained_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
            + self.lower_path.capacity()
            + self.name.capacity()
            + self.path.capacity()
    }
    fn compare(&self, other: &Self) -> Ordering {
        self.lower_path
            .cmp(&other.lower_path)
            .then_with(|| self.path.cmp(&other.path))
    }
    fn entry(&self, root_id: &str, root_path: &str) -> FileSearchEntry {
        FileSearchEntry {
            name: self.name.clone(),
            path: self.path.clone(),
            root_id: root_id.to_owned(),
            root_path: root_path.to_owned(),
        }
    }
}

pub(super) struct ScanResult {
    pub index: Option<Arc<[IndexedFile]>>,
    pub data: Vec<FileSearchEntry>,
}

/// 超预算后释放索引，继续扫描全部目录，仅保留排序最靠前的 50 个匹配项。
/// 不能简单截断文件表，否则目录末尾的文件会永久无法搜索。
pub(super) fn scan(
    root: &Path,
    query: &str,
    root_id: &str,
    token: &CancellationToken,
    budget: usize,
) -> Result<ScanResult, WorkspaceError> {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(true)
        .parents(true)
        .ignore(true)
        .git_global(true)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false);
    let mut files = Vec::new();
    let mut matches: Vec<IndexedFile> = Vec::with_capacity(MAX_SEARCH_RESULTS);
    let mut bytes = 0_usize;
    let mut cacheable = true;
    for entry in builder.build() {
        if token.is_cancelled() {
            return Ok(ScanResult {
                index: None,
                data: Vec::new(),
            });
        }
        let entry = entry.map_err(|error| std::io::Error::other(error.to_string()))?;
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let path = relative_string(root, entry.path())?;
        let file = IndexedFile {
            lower_path: path.to_lowercase(),
            name: entry.file_name().to_string_lossy().into_owned(),
            path,
        };
        if file.lower_path.contains(query) {
            let position = matches
                .binary_search_by(|current| current.compare(&file))
                .unwrap_or_else(|index| index);
            if position < MAX_SEARCH_RESULTS {
                matches.insert(position, file.clone());
                if matches.len() > MAX_SEARCH_RESULTS {
                    matches.pop();
                }
            }
        }
        if cacheable {
            bytes = bytes.saturating_add(file.retained_bytes());
            if bytes > budget {
                files = Vec::new();
                cacheable = false;
            } else {
                files.push(file);
            }
        }
    }
    if token.is_cancelled() {
        return Ok(ScanResult {
            index: None,
            data: Vec::new(),
        });
    }
    let index = cacheable.then(|| {
        files.sort_unstable_by(IndexedFile::compare);
        Arc::from(files)
    });
    let root_path = root.to_string_lossy();
    Ok(ScanResult {
        index,
        data: matches
            .iter()
            .map(|file| file.entry(root_id, &root_path))
            .collect(),
    })
}

pub(super) fn search_index(
    files: &[IndexedFile],
    query: &str,
    root_id: &str,
    root_path: &str,
    token: &CancellationToken,
) -> Vec<FileSearchEntry> {
    files
        .iter()
        .take_while(|_| !token.is_cancelled())
        .filter(|file| file.lower_path.contains(query))
        .take(MAX_SEARCH_RESULTS)
        .map(|file| file.entry(root_id, root_path))
        .collect()
}
