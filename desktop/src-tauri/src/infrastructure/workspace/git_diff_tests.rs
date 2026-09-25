use std::{fs, time::SystemTime};

use super::{git_diff::add_diffs, git_read::GitChange};

#[tokio::test]
async fn add_diffs_should_include_untracked_text_file_additions() {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codeagent-git-diff-{unique}"));
    fs::create_dir_all(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    fs::write(root.join("new.txt"), "first\nsecond\nthird\n").unwrap();
    let mut changes = vec![GitChange {
        truncated: false,
        stats: Default::default(),
        diff: String::new(),
        kind: "create",
        path: "new.txt".to_owned(),
        original_path: None,
    }];

    add_diffs(&root, &mut changes, false).await.unwrap();
    let addition_count = changes[0]
        .diff
        .lines()
        .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
        .count();
    fs::remove_dir_all(root).unwrap();

    assert_eq!(addition_count, 3);
    assert_eq!(
        changes[0].diff,
        "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,3 @@\n+first\n+second\n+third\n"
    );
    assert_eq!(
        serde_json::to_value(&changes[0]).unwrap()["stats"],
        serde_json::json!({"additions":3,"removals":0})
    );
}

#[tokio::test]
async fn file_change_stats_should_count_git_add_delete_and_update_patches() {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codeagent-git-stats-{unique}"));
    fs::create_dir_all(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(&root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init", "-q"]);
    fs::write(root.join("delete.txt"), "old\n").unwrap();
    fs::write(root.join("edit.txt"), "-- old\n").unwrap();
    git(&["add", "."]);
    git(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "initial",
    ]);
    fs::remove_file(root.join("delete.txt")).unwrap();
    fs::write(root.join("edit.txt"), "++ new\n").unwrap();
    fs::write(root.join("create.txt"), "first\nsecond\n").unwrap();
    git(&["add", "."]);
    let mut changes: Vec<_> = [
        ("delete.txt", "delete"),
        ("edit.txt", "update"),
        ("create.txt", "create"),
    ]
    .into_iter()
    .map(|(path, kind)| GitChange {
        truncated: false,
        path: path.into(),
        kind,
        diff: String::new(),
        stats: Default::default(),
        original_path: None,
    })
    .collect();
    add_diffs(&root, &mut changes, true).await.unwrap();
    let stats: Vec<_> = changes
        .iter()
        .map(|change| serde_json::to_value(change.stats).unwrap())
        .collect();
    fs::remove_dir_all(&root).unwrap();
    assert_eq!(
        stats,
        vec![
            serde_json::json!({"additions":0,"removals":1}),
            serde_json::json!({"additions":1,"removals":1}),
            serde_json::json!({"additions":2,"removals":0}),
        ]
    );
}
