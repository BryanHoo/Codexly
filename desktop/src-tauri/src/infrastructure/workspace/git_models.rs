use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// 全仓行数汇总，不受分页或补丁预览截断影响。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<crate::domain::file_change::FileChangeStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_changes: Option<usize>,
    pub base_branches: Vec<String>,
    pub branch: Option<String>,
    pub branches: Vec<String>,
    pub repository_mode: &'static str,
    pub snapshot: String,
    pub staged: Vec<GitChange>,
    pub unstaged: Vec<GitChange>,
}

#[derive(Clone, Debug, Serialize)]
pub struct GitChange {
    #[serde(skip_serializing_if = "is_false")]
    pub truncated: bool,
    pub stats: crate::domain::file_change::FileChangeStats,
    pub diff: String,
    pub kind: &'static str,
    pub path: String,
    #[serde(skip)]
    pub original_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistoryPage {
    pub branch: Option<String>,
    pub commits: Vec<GitCommit>,
    pub next_cursor: Option<String>,
    pub repositories: Vec<String>,
    pub repository: Option<String>,
    pub repository_mode: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub authored_at: String,
    pub author_email: String,
    pub author_name: String,
    pub sha: String,
    pub title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFilesPage {
    pub files: Vec<CommitFile>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CommitFile {
    pub kind: &'static str,
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct CommitDiff {
    pub diff: String,
    pub truncated: bool,
}

fn is_false(value: &bool) -> bool {
    !value
}
