use std::path::PathBuf;

use crate::application::error::AppError;
use crate::infrastructure::{
    local_catalog::{LocalCatalog, sidebar::map_project},
    workspace,
};

/// 项目与工作树授权只依赖应用目录及本地 Git，不依赖任何引擎进程或凭据。
pub(super) async fn resolve(
    catalog: &LocalCatalog,
    project_id: &str,
    root_path: &str,
) -> Result<(PathBuf, String), AppError> {
    let project = map_project(
        &catalog
            .call("project.read", serde_json::json!({"id": project_id}))
            .await?,
    )?;
    let canonical = workspace::canonical_root(root_path)
        .await
        .map_err(|_| AppError::FilesystemRequestFailed)?;
    if let Some(root) = project.roots.iter().find(|root| root.path == root_path) {
        return Ok((canonical, root.id.clone()));
    }
    for root in project.roots {
        if workspace::switch_worktree(std::path::Path::new(&root.path), None, root_path)
            .await
            .is_ok()
        {
            return Ok((canonical, "worktree".to_owned()));
        }
    }
    Err(AppError::FilesystemRequestFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn authorizes_local_project_without_codex_and_rejects_unrelated_paths() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("workspace");
        let unrelated = directory.path().join("unrelated");
        tokio::fs::create_dir(&root).await.unwrap();
        tokio::fs::create_dir(&unrelated).await.unwrap();
        let catalog = LocalCatalog::at(&directory.path().join("data")).unwrap();
        let project = catalog
            .add_project(vec![root.to_str().unwrap().to_owned()])
            .await
            .unwrap();
        let resolved = resolve(&catalog, &project.id, &project.roots[0].path)
            .await
            .unwrap();
        assert_eq!(resolved.0, std::fs::canonicalize(&root).unwrap());
        assert!(
            resolve(&catalog, &project.id, unrelated.to_str().unwrap())
                .await
                .is_err()
        );
        assert!(
            resolve(&catalog, "missing", root.to_str().unwrap())
                .await
                .is_err()
        );
    }
}
