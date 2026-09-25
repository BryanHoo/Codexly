//! 行数直接读取 Git numstat，不生成或传输补丁正文；逐条处理特殊路径及 rename。
use std::{collections::HashMap, path::Path};

use crate::domain::file_change::FileChangeStats;

use super::{
    git_models::GitChange,
    git_protocol::{invalid, path_text},
    path_guard::WorkspaceError,
};

pub(super) async fn read_stats(
    repo: &Path,
    staged: &mut [GitChange],
    unstaged: &mut [GitChange],
) -> Result<FileChangeStats, WorkspaceError> {
    tokio::try_join!(
        read_side(repo, staged, true),
        read_side(repo, unstaged, false)
    )?;
    Ok(staged.iter().chain(unstaged.iter()).fold(
        FileChangeStats::default(),
        |mut total, change| {
            total.additions += change.stats.additions;
            total.removals += change.stats.removals;
            total
        },
    ))
}

async fn read_side(
    repo: &Path,
    changes: &mut [GitChange],
    staged: bool,
) -> Result<(), WorkspaceError> {
    if changes.is_empty() {
        return Ok(());
    }
    let paths: HashMap<_, _> = changes
        .iter()
        .enumerate()
        .map(|(index, change)| (change.path.clone(), index))
        .collect();
    let mut args = vec![
        "diff",
        "--numstat",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
        "--no-relative",
        "--submodule=short",
        "--ignore-submodules=none",
    ];
    if staged {
        args.push("--cached");
    } else {
        args.push("--base");
    }
    args.push("--");
    let mut parser = Numstat::default();
    super::git_stream::fold_records(repo, &args, (), |(), record| {
        if let Some((path, stats)) = parser.record(record)?
            && let Some(index) = paths.get(path)
        {
            // 未跟踪文件由内容指纹扫描统计；tracked 条目以 Git 自身结果覆盖。
            changes[*index].stats = stats;
        }
        Ok(())
    })
    .await?;
    if parser.rename.is_some() {
        return Err(invalid("numstat", "missing rename path"));
    }
    Ok(())
}

#[derive(Default)]
struct Numstat {
    rename: Option<(FileChangeStats, bool)>,
}

impl Numstat {
    fn record<'a>(
        &mut self,
        record: &'a [u8],
    ) -> Result<Option<(&'a str, FileChangeStats)>, WorkspaceError> {
        let record = record
            .strip_suffix(&[0])
            .ok_or_else(|| invalid("numstat", "missing NUL"))?;
        if let Some((stats, skip_source)) = self.rename {
            let path = path_text(record)?;
            if skip_source {
                self.rename = Some((stats, false));
                return Ok(None);
            }
            self.rename = None;
            return Ok(Some((path, stats)));
        }
        let mut fields = record.splitn(3, |byte| *byte == b'\t');
        let additions = number(fields.next())?;
        let removals = number(fields.next())?;
        let path = fields
            .next()
            .ok_or_else(|| invalid("numstat", "missing path"))?;
        let stats = FileChangeStats {
            additions,
            removals,
        };
        if path.is_empty() {
            // -z 的 rename 是三条 NUL 记录，旧路径和新路径不能按换行或 tab 拆分。
            self.rename = Some((stats, true));
            Ok(None)
        } else {
            Ok(Some((path_text(path)?, stats)))
        }
    }
}

fn number(value: Option<&[u8]>) -> Result<usize, WorkspaceError> {
    match value {
        Some(b"-") => Ok(0), // 二进制文件没有文本行数。
        Some(bytes) => std::str::from_utf8(bytes)
            .ok()
            .and_then(|text| text.parse().ok())
            .ok_or_else(|| invalid("numstat", "invalid count")),
        None => Err(invalid("numstat", "missing count")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numstat_should_parse_rename_path_with_tabs_and_newlines() {
        let stats = FileChangeStats {
            additions: 1,
            removals: 0,
        };
        let mut parser = Numstat::default();

        assert_eq!(parser.record(b"1\t0\t\0").unwrap(), None);
        assert_eq!(parser.record(b"old.txt\0").unwrap(), None);
        assert_eq!(
            parser.record(b"new\tname\n[1].txt\0").unwrap(),
            Some(("new\tname\n[1].txt", stats))
        );
        assert!(parser.rename.is_none());
    }
}
