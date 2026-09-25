use std::{fs, time::SystemTime};

use super::{MAX_FILE_BYTES, import_attachment};

#[tokio::test]
async fn oversized_host_file_should_report_the_attachment_limit() {
    let unique = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("codeagent-oversized-attachment-{unique}"));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("archive.zip");
    fs::File::create(&source)
        .unwrap()
        .set_len((MAX_FILE_BYTES + 1) as u64)
        .unwrap();

    let error = import_attachment(&root, "project-a", "file", source.to_str().unwrap())
        .await
        .expect_err("oversized files should be rejected before reading");

    assert_eq!(error.code(), "ATTACHMENT_TOO_LARGE");
    fs::remove_dir_all(root).unwrap();
}
