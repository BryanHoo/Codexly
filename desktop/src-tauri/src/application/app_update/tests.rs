use super::{AppUpdate, confirm_release_with_manifest, resolve_release_response_for_channel};

#[tokio::test]
async fn release_client_uses_codexly_user_agent() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            socket.read_exact(&mut byte).await.unwrap();
            bytes.push(byte[0]);
        }
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            .await
            .unwrap();
        String::from_utf8(bytes).unwrap()
    });
    super::http_client()
        .unwrap()
        .get(format!("http://{address}"))
        .send()
        .await
        .unwrap();
    assert!(
        server
            .await
            .unwrap()
            .to_ascii_lowercase()
            .contains("user-agent: codexly\r\n")
    );
}

#[tokio::test]
async fn stalled_response_body_should_report_connection_failure() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        // 确认客户端已发出请求，再模拟只返回部分正文的服务端。
        let mut request = [0; 1];
        socket.read_exact(&mut request).await.unwrap();
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n[")
            .await
            .unwrap();
        std::future::pending::<()>().await;
    });
    let response = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(1))
        .build()
        .unwrap()
        .get(format!("http://{address}"))
        .send()
        .await
        .unwrap();
    let error = super::read_bounded_body(response).await.unwrap_err();
    server.abort();
    assert!(matches!(error, super::UpdateCheckError::ConnectionFailed));
}

#[test]
fn newer_github_release_should_be_available_with_its_notes() {
    let update = resolve_release_response_for_channel(
        "0.1.0",
        br###"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.0 -->\n## Added\n\n- New flow"}]"###,
        None,
    );

    assert_eq!(
        update,
        AppUpdate {
            latest_version: Some("0.2.0".to_owned()),
            release_notes: "## Added\n\n- New flow".to_owned(),
            release_notes_version: "0.2.0".to_owned(),
            status: "available",
            update_available: true,
        }
    );
}

#[test]
fn matching_github_release_should_be_current() {
    let update = resolve_release_response_for_channel(
        "0.2.0",
        br#"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.0 -->\nCurrent notes"}]"#,
        None,
    );

    assert_eq!(update.status, "current");
    assert!(!update.update_available);
    assert_eq!(update.release_notes_version, "0.2.0");
}

#[test]
fn no_release_should_only_be_current_for_initial_version() {
    let initial = resolve_release_response_for_channel("0.1.0", b"[]", None);
    let later = resolve_release_response_for_channel("0.2.0", b"[]", None);

    assert_eq!(initial.status, "current");
    assert_eq!(initial.latest_version, None);
    assert_eq!(initial.release_notes_version, "0.1.0");
    assert_eq!(later.status, "check-failed");
}

#[test]
fn legacy_should_not_offer_a_release_before_its_manifest_is_uploaded() {
    let body = br#"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.0 -->\nNotes","assets":[{"name":"latest.json"}]}]"#;
    assert!(
        !super::resolve_release_response_for_channel("0.1.0", body, Some("latest-legacy.json"))
            .update_available
    );
    assert!(
        super::resolve_release_response_for_channel("0.1.0", body, Some("latest.json"))
            .update_available
    );
}

#[test]
fn missing_api_assets_should_require_manifest_confirmation() {
    let update = resolve_release_response_for_channel(
        "0.2.3",
        br#"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.4 -->\nNotes","assets":[]}]"#,
        Some("latest.json"),
    );

    assert_eq!(update.status, "check-failed");
}

#[test]
fn matching_channel_manifest_should_offer_release_when_api_assets_are_missing() {
    let candidate = resolve_release_response_for_channel(
        "0.2.3",
        br#"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.4 -->\nNotes","assets":[]}]"#,
        None,
    );

    let update = confirm_release_with_manifest("0.2.3", candidate, Some("0.2.4"));

    assert_eq!(update.status, "available");
    assert_eq!(update.latest_version.as_deref(), Some("0.2.4"));
}

#[test]
fn older_channel_manifest_should_not_offer_uninstallable_release() {
    let candidate = resolve_release_response_for_channel(
        "0.2.3",
        br#"[{"tag_name":"v0.26.0","body":"<!-- codeagent-version: 0.2.4 -->\nNotes","assets":[]}]"#,
        None,
    );

    let update = confirm_release_with_manifest("0.2.3", candidate, Some("0.2.2"));

    assert_eq!(update.status, "current");
    assert!(!update.update_available);
}
