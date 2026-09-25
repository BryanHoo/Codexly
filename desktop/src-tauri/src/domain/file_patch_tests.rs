use super::FilePatch;
use crate::domain::file_change::FileChangeStats;

#[test]
fn file_patch_should_preserve_raw_markers_empty_lines_and_trailing_spaces() {
    for kind in ["create", "delete"] {
        let patch = FilePatch::codex(
            "sample.txt",
            kind,
            "+++ text\n--- text\n@@ text\nlast  \n\n",
            usize::MAX,
        );
        let (old, new, range, prefix) = if kind == "create" {
            ("/dev/null", "b/sample.txt", "-0,0 +1,5", '+')
        } else {
            ("a/sample.txt", "/dev/null", "-1,5 +0,0", '-')
        };
        assert_eq!(
            patch.diff,
            format!(
                "--- {old}\n+++ {new}\n@@ {range} @@\n{prefix}+++ text\n{prefix}--- text\n{prefix}@@ text\n{prefix}last  \n{prefix}\n"
            )
        );
        assert!(!patch.truncated);
    }
}

#[test]
fn file_patch_should_preserve_crlf_and_mark_missing_final_newline() {
    assert_eq!(
        FilePatch::codex("a", "create", "first\r\nlast  ", usize::MAX).diff,
        "--- /dev/null\n+++ b/a\n@@ -0,0 +1,2 @@\n+first\r\n+last  \n\\ No newline at end of file\n"
    );
    assert_eq!(
        FilePatch::codex("a", "create", "", usize::MAX).diff,
        "--- /dev/null\n+++ b/a\n"
    );
}

#[test]
fn file_patch_should_keep_complete_git_patch_unchanged() {
    for source in [
        "diff --git a/a b/a\nnew file mode 100644\n--- /dev/null\n+++ b/a\n@@ -0,0 +1 @@\n+last  \n",
        "--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new  \n",
        "diff --git a/a b/a\nBinary files a/a and b/a differ\n",
    ] {
        // Git 已携带补丁；调用更新规范化路径时不能按新增原始内容重新包装。
        assert_eq!(
            FilePatch::codex("a", "update", source, usize::MAX).diff,
            source
        );
    }
}

#[test]
fn file_patch_should_add_missing_headers_and_keep_hunk_body_markers() {
    let patch = FilePatch::codex(
        "\\src\\a.txt",
        "update",
        "@@ -1 +1 @@\n--- old\n+++ new  \n",
        usize::MAX,
    );
    assert_eq!(
        patch.diff,
        "--- a/src/a.txt\n+++ b/src/a.txt\n@@ -1 +1 @@\n--- old\n+++ new  \n"
    );
    assert_eq!(
        FileChangeStats::patch(&patch.diff),
        FileChangeStats {
            additions: 1,
            removals: 1
        }
    );
}

#[test]
fn file_patch_should_normalize_fragments_without_doubling_context_prefix() {
    assert_eq!(
        FilePatch::codex("a", "update", " context\nplain\n-old\n+new  \n", usize::MAX).diff,
        "--- a/a\n+++ b/a\n@@ -1,3 +1,3 @@\n context\n plain\n-old\n+new  \n"
    );
}

#[test]
fn file_patch_should_bound_expansion_and_never_split_utf8() {
    let source = "🌍\n\n".repeat(1000);
    let full = FilePatch::codex("中文.txt", "create", &source, usize::MAX);
    for limit in [0, 1, 20, 100, source.len(), full.diff.len()] {
        let patch = FilePatch::codex("中文.txt", "create", &source, limit);
        assert!(patch.diff.len() <= limit);
        assert!(!patch.diff.contains('\u{fffd}'));
        assert_eq!(patch.truncated, limit < full.diff.len());
    }
}

#[test]
fn file_patch_should_quote_control_characters_in_synthetic_headers() {
    assert_eq!(
        FilePatch::codex("a\nb.txt", "create", "text\n", usize::MAX).diff,
        "--- /dev/null\n+++ \"b/a\\nb.txt\"\n@@ -0,0 +1,1 @@\n+text\n"
    );
}

#[test]
fn file_patch_should_describe_only_retained_lines_when_synthetic_body_is_truncated() {
    for (kind, source) in [
        ("create", "line\n".repeat(100)),
        ("update", "+line\n".repeat(100)),
    ] {
        let patch = FilePatch::codex("a", kind, &source, 100);
        let stats = FileChangeStats::patch(&patch.diff);
        assert!(patch.truncated);
        assert!(
            patch
                .diff
                .contains(&format!("@@ -0,0 +1,{} @@\n", stats.additions)),
            "{}",
            patch.diff
        );
        assert!(patch.diff.ends_with('\n'));
    }
}
#[test]
fn file_patch_should_preserve_backslash_context_in_fragments() {
    let patch = super::FilePatch::codex(
        "a",
        "update",
        "\\path\n+new\n\\ No newline at end of file\n",
        usize::MAX,
    );
    assert_eq!(
        patch.diff,
        "--- a/a\n+++ b/a\n@@ -1,1 +1,2 @@\n \\path\n+new\n\\ No newline at end of file\n"
    );
}
