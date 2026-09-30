use std::fs;

use super::{SOURCE_CHUNK_BYTES, read_source_file};
use crate::infrastructure::workspace::path_guard::WorkspaceError;

#[tokio::test]
async fn source_pages_should_preserve_multibyte_characters_at_every_split() {
    let root = tempfile::tempdir().unwrap();
    let relative = "source.txt";
    for character in ["\u{e9}", "\u{4e2d}", "\u{1f600}"] {
        for split in 1..character.len() {
            let prefix = "x".repeat(SOURCE_CHUNK_BYTES - split);
            let source = format!("{prefix}{}", character.repeat(SOURCE_CHUNK_BYTES));
            fs::write(root.path().join(relative), &source).unwrap();

            let first = read_source_file(root.path(), relative, None).await.unwrap();
            assert_eq!(first.content, prefix);
            assert_eq!(first.next_cursor, Some(prefix.len()));
            assert_eq!(first.path, relative);

            let mut reconstructed = first.content;
            let mut cursor = first.next_cursor;
            while let Some(offset) = cursor {
                let page = read_source_file(root.path(), relative, Some(offset))
                    .await
                    .unwrap();
                assert!(!page.content.is_empty());
                assert!(page.content.len() <= SOURCE_CHUNK_BYTES);
                reconstructed.push_str(&page.content);
                if let Some(next) = page.next_cursor {
                    assert_eq!(next, offset + page.content.len());
                }
                cursor = page.next_cursor;
            }
            assert_eq!(reconstructed, source);
        }
    }
}

#[tokio::test]
async fn source_pages_should_keep_complete_characters_at_the_byte_limit() {
    let root = tempfile::tempdir().unwrap();
    let prefix = "\u{1f600}".repeat(SOURCE_CHUNK_BYTES / 4);
    fs::write(root.path().join("source.txt"), format!("{prefix}tail")).unwrap();

    let first = read_source_file(root.path(), "source.txt", None)
        .await
        .unwrap();
    assert_eq!(first.content, prefix);
    assert_eq!(first.next_cursor, Some(SOURCE_CHUNK_BYTES));
    let last = read_source_file(root.path(), "source.txt", first.next_cursor)
        .await
        .unwrap();
    assert_eq!(last.content, "tail");
    assert_eq!(last.next_cursor, None);
}

#[tokio::test]
async fn source_pages_should_reject_invalid_utf8_including_near_the_page_end() {
    let root = tempfile::tempdir().unwrap();
    for invalid_offset in [0, SOURCE_CHUNK_BYTES - 3, SOURCE_CHUNK_BYTES - 1] {
        let mut bytes = vec![b'x'; SOURCE_CHUNK_BYTES + 4];
        bytes[invalid_offset] = 0xff;
        fs::write(root.path().join("source.txt"), bytes).unwrap();

        assert!(matches!(
            read_source_file(root.path(), "source.txt", None).await,
            Err(WorkspaceError::InvalidPath)
        ));
    }
}

#[tokio::test]
async fn source_pages_should_reject_incomplete_utf8_at_eof() {
    let root = tempfile::tempdir().unwrap();
    for length in [1, SOURCE_CHUNK_BYTES, SOURCE_CHUNK_BYTES + 1] {
        let mut bytes = vec![b'x'; length];
        bytes[length - 1] = 0xe4;
        fs::write(root.path().join("source.txt"), bytes).unwrap();
        let cursor = (length > SOURCE_CHUNK_BYTES).then_some(SOURCE_CHUNK_BYTES);

        assert!(matches!(
            read_source_file(root.path(), "source.txt", cursor).await,
            Err(WorkspaceError::InvalidPath)
        ));
    }
}

#[tokio::test]
async fn source_pages_should_reject_cursors_inside_multibyte_characters() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("source.txt"), "\u{4e2d}\u{1f600}").unwrap();
    for cursor in [1, 2, 4, 5, 6, 8] {
        assert!(matches!(
            read_source_file(root.path(), "source.txt", Some(cursor)).await,
            Err(WorkspaceError::InvalidPath)
        ));
    }
}

#[tokio::test]
async fn source_pages_should_return_empty_content_at_eof() {
    let root = tempfile::tempdir().unwrap();
    for source in ["", "\u{4e2d}\u{1f600}"] {
        fs::write(root.path().join("source.txt"), source).unwrap();
        let page = read_source_file(root.path(), "source.txt", Some(source.len()))
            .await
            .unwrap();
        assert_eq!(page.content, "");
        assert_eq!(page.next_cursor, None);
    }
}
