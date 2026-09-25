use super::{
    git_models::GitChange,
    git_protocol::{invalid, nul_records, path_text, validate_sha},
    path_guard::WorkspaceError,
};

#[derive(Default)]
pub(super) struct StatusRecords {
    pub branch: Option<String>,
    pub head: Option<String>,
    pub gitlinks: Vec<String>,
    pub staged: Vec<GitChange>,
    pub unstaged: Vec<GitChange>,
}

pub(super) fn parse_status(output: &[u8]) -> Result<StatusRecords, WorkspaceError> {
    let mut status = StatusRecords::default();
    let mut records = nul_records(output, "status")?;
    let result = &mut status;
    while let Some(record) = records.next() {
        if let Some(value) = record.strip_prefix(b"# branch.head ") {
            if value != b"(detached)" {
                result.branch = Some(
                    std::str::from_utf8(value)
                        .map_err(|_| invalid("status", "branch is not UTF-8"))?
                        .to_owned(),
                );
            }
            continue;
        }
        if let Some(value) = record.strip_prefix(b"# branch.oid ") {
            if value != b"(initial)" {
                let head =
                    std::str::from_utf8(value).map_err(|_| invalid("status", "invalid HEAD"))?;
                validate_sha(head)?;
                result.head = Some(head.to_owned());
            }
            continue;
        }
        match record.first() {
            // porcelain v2 明确允许扩展头字段；忽略未知头，不忽略未知变更记录。
            Some(b'#' | b'!') => continue,
            Some(b'?') => {
                let path = record
                    .strip_prefix(b"? ")
                    .ok_or_else(|| invalid("status", "invalid untracked entry"))?;
                result.unstaged.push(change(path_text(path)?, b'?', None));
            }
            Some(kind @ (b'1' | b'2' | b'u')) => {
                // 只拆固定数量的元数据字段，路径中的空格、制表符和换行必须原样保留。
                let count = match kind {
                    b'1' => 9,
                    b'2' => 10,
                    _ => 11,
                };
                let fields: Vec<_> = record.splitn(count, |byte| *byte == b' ').collect();
                if fields.len() != count || fields[1].len() != 2 {
                    return Err(invalid("status", "incomplete tracked entry"));
                }
                let path = path_text(fields[count - 1])?;
                if fields[2].starts_with(b"S") {
                    result.gitlinks.push(path.to_owned());
                }
                let original = if *kind == b'2' {
                    Some(path_text(records.next().ok_or_else(|| {
                        invalid("status", "missing rename source")
                    })?)?)
                } else {
                    None
                };
                if *kind == b'u' {
                    // 冲突文件没有可提交的 stage-0 内容，只在工作区展示其冲突正文。
                    result.unstaged.push(change(path, b'M', None));
                    continue;
                }
                let xy = fields[1];
                if xy[0] != b'.' {
                    result.staged.push(change(path, xy[0], original));
                }
                if xy[1] != b'.' {
                    result.unstaged.push(change(path, xy[1], original));
                }
            }
            _ => return Err(invalid("status", "unknown record type")),
        }
    }
    Ok(status)
}

fn change(path: &str, code: u8, original: Option<&str>) -> GitChange {
    GitChange {
        truncated: false,
        stats: Default::default(),
        diff: String::new(),
        kind: change_kind(code),
        path: path.to_owned(),
        original_path: (code == b'R')
            .then(|| original.map(str::to_owned))
            .flatten(),
    }
}

pub(super) fn change_kind(code: u8) -> &'static str {
    match code {
        b'A' | b'?' => "create",
        b'D' => "delete",
        _ => "update",
    }
}

#[cfg(test)]
#[path = "git_status_parse_tests.rs"]
mod tests;
