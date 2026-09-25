use super::{
    git_process::run_git_with_index, git_stream::fold_records, path_guard::WorkspaceError,
};
use std::{collections::HashSet, path::Path};

pub(super) fn path_input<'a>(paths: impl IntoIterator<Item = &'a str>) -> Vec<u8> {
    let mut input = Vec::new();
    for path in paths {
        input.extend_from_slice(super::git_protocol::literal_path(path).as_bytes());
        input.push(0);
    }
    input
}

/// 通过 stdin 一次复制所选 index 条目，避免文件数量触发 argv 或 2 MiB 输出限制。
pub(super) async fn copy_staged(
    repo: &Path,
    index: &Path,
    paths: &[&String],
) -> Result<(), WorkspaceError> {
    let selected: HashSet<_> = paths.iter().map(|path| path.as_str()).collect();
    let format = super::git_protocol::read_complete(
        repo,
        &["rev-parse", "--show-object-format"],
        "object format",
        64,
    )
    .await?;
    let zero = if format.starts_with(b"sha256") {
        "0".repeat(64)
    } else {
        "0".repeat(40)
    };
    let mut input = Vec::new();
    for path in &selected {
        input.extend_from_slice(format!("0 {zero}\t{path}\0").as_bytes());
    }
    let input = fold_records(
        repo,
        &["ls-files", "--stage", "-z"],
        input,
        |input, record| {
            let separator = record
                .iter()
                .position(|byte| *byte == b'\t')
                .ok_or_else(|| super::git_protocol::invalid("index", "missing path"))?;
            let path = super::git_protocol::path_text(&record[separator + 1..record.len() - 1])?;
            if selected.contains(path) {
                input.extend_from_slice(record);
            }
            Ok(())
        },
    )
    .await?;
    run_git_with_index(
        repo,
        &["update-index", "-z", "--index-info"],
        64 * 1024,
        index,
        Some(&input),
    )
    .await?;
    Ok(())
}
