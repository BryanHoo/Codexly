use serde::Serialize;

/// 行数元数据：补丁预览统计返回正文，Git 清单的 numstat 统计完整变更。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FileChangeStats {
    pub additions: usize,
    pub removals: usize,
}

impl FileChangeStats {
    pub fn codex(kind: &str, diff: &str) -> Self {
        match kind {
            "create" => Self {
                additions: content_lines(diff),
                removals: 0,
            },
            "delete" => Self {
                additions: 0,
                removals: content_lines(diff),
            },
            _ => Self::patch(diff),
        }
    }

    pub fn patch(diff: &str) -> Self {
        let mut stats = Self::default();
        let mut in_hunk = false;
        // 借用逐行切片，不创建行数组；hunk 内的 +++/--- 是代码，不是文件头。
        for line in diff.split('\n') {
            if line.starts_with("diff --git ") {
                in_hunk = false;
            } else if line.starts_with("@@ ") {
                in_hunk = true;
            } else if !in_hunk && (line.starts_with("+++ ") || line.starts_with("--- ")) {
                continue;
            } else if line.starts_with('+') {
                stats.additions += 1;
            } else if line.starts_with('-') {
                stats.removals += 1;
            }
        }
        stats
    }
}

pub(crate) fn content_lines(content: &str) -> usize {
    content.bytes().filter(|byte| *byte == b'\n').count()
        + usize::from(!content.is_empty() && !content.ends_with('\n'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_change_stats_should_count_raw_content_without_treating_markers_as_headers() {
        for (text, lines) in [
            ("", 0),
            ("line", 1),
            ("line\n", 1),
            ("line\n\n", 2),
            ("line\r\n\r\n", 2),
            ("+++ content\n--- content\n@@ content\n", 3),
            ("中文\n🌍", 2),
        ] {
            assert_eq!(
                FileChangeStats::codex("create", text),
                FileChangeStats {
                    additions: lines,
                    removals: 0
                }
            );
            assert_eq!(
                FileChangeStats::codex("delete", text),
                FileChangeStats {
                    additions: 0,
                    removals: lines
                }
            );
        }
    }

    #[test]
    fn file_change_stats_should_ignore_metadata_but_count_markers_inside_each_hunk() {
        let diff = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n--- content\n+++ content\n same\n\\ No newline at end of file\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-old\n+new\n";
        assert_eq!(
            FileChangeStats::patch(diff),
            FileChangeStats {
                additions: 2,
                removals: 2
            }
        );
    }

    #[test]
    fn file_change_stats_should_handle_headerless_empty_and_binary_patches() {
        assert_eq!(
            FileChangeStats::patch("-old\r\n+new\r\n+\r\n"),
            FileChangeStats {
                additions: 2,
                removals: 1
            }
        );
        for diff in [
            "",
            "diff --git a/a b/a\nnew file mode 100644\n",
            "Binary files a/a and b/a differ\n",
        ] {
            assert_eq!(FileChangeStats::patch(diff), FileChangeStats::default());
        }
    }
}
