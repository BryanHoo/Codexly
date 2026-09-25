use super::parse_status;

#[test]
fn porcelain_v2_should_preserve_rename_paths_and_ignore_extension_headers() {
    let oid = "a".repeat(40);
    let data = format!(
        "# branch.oid {oid}\0# branch.head main\0# future.header ignored\0? new/\02 RM N... 100644 100644 100644 {oid} {oid} R100 new name\nfile\0old name\nfile\0"
    );
    let status = parse_status(data.as_bytes()).unwrap();
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert_eq!(status.staged[0].path, "new name\nfile");
    assert_eq!(
        status.staged[0].original_path.as_deref(),
        Some("old name\nfile")
    );
    assert_eq!(status.unstaged[0].path, "new/");
    assert_eq!(status.unstaged[1].path, "new name\nfile");
}

#[test]
fn porcelain_v2_should_distinguish_protocol_and_encoding_errors() {
    let error = parse_status(b"? incomplete").err().unwrap();
    assert_eq!(error.code(), "GIT_OUTPUT_INVALID");
    let error = parse_status(b"? bad-\xff\0").err().unwrap();
    assert_eq!(error.code(), "GIT_PATH_ENCODING_UNSUPPORTED");
}

#[test]
fn porcelain_v2_should_support_unborn_detached_and_sha256_heads() {
    let unborn = parse_status(b"# branch.oid (initial)\0# branch.head main\0").unwrap();
    assert!(unborn.head.is_none());
    assert_eq!(unborn.branch.as_deref(), Some("main"));
    let oid = "b".repeat(64);
    let detached =
        parse_status(format!("# branch.oid {oid}\0# branch.head (detached)\0").as_bytes()).unwrap();
    assert!(detached.branch.is_none());
    assert_eq!(detached.head.as_deref(), Some(oid.as_str()));
}
