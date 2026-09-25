use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Instant,
};

use super::*;

static TEST_ID: AtomicU64 = AtomicU64::new(1);

fn response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn server(responses: Vec<String>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let task = tokio::task::spawn_blocking(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut requests = Vec::new();
        for response in responses {
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "missing download request");
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("mock server failed: {error}"),
                }
            };
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                socket.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
                assert!(request.len() < 16 * 1024);
            }
            requests.push(
                String::from_utf8(request)
                    .unwrap()
                    .lines()
                    .next()
                    .unwrap()
                    .to_owned(),
            );
            socket.write_all(response.as_bytes()).unwrap();
        }
        requests
    });
    (url, task)
}

async fn download(
    responses: Vec<String>,
) -> (Result<(), RuntimeInstallError>, Vec<String>, Vec<u8>) {
    let (url, task) = server(responses);
    let root = std::env::temp_dir().join(format!(
        "codeagent-download-{}-{}",
        std::process::id(),
        TEST_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).await.unwrap();
    let archive = root.join("runtime.tgz");
    let events = Mutex::new(Vec::new());
    let on_progress = |event| events.lock().unwrap().push(event);
    let mut progress = DownloadProgressReporter::new(&on_progress, None);
    let client = Client::builder()
        .no_proxy()
        .redirect(download_redirect_policy())
        .build()
        .unwrap();
    let integrity = STANDARD.encode(Sha512::digest(b"verified"));
    let result = download_from_sources(
        &client,
        [&format!("{url}/mirror"), &format!("{url}/official")],
        &integrity,
        &archive,
        &mut progress,
    )
    .await;
    let bytes = fs::read(&archive).await.unwrap_or_default();
    fs::remove_dir_all(&root).await.unwrap();
    let requests = task.await.unwrap();
    assert!(
        events
            .lock()
            .unwrap()
            .windows(2)
            .all(|pair| pair[0].sequence < pair[1].sequence)
    );
    (result, requests, bytes)
}

#[tokio::test]
async fn successful_mirror_should_not_request_official_source() {
    let (result, requests, bytes) = download(vec![response("200 OK", "verified")]).await;
    assert!(result.is_ok());
    assert_eq!(requests, ["GET /mirror HTTP/1.1"]);
    assert_eq!(bytes, b"verified");
}

#[tokio::test]
async fn mirror_failures_should_fall_back_to_the_verified_official_archive() {
    for failed in [
        response("503 Service Unavailable", ""),
        response("200 OK", "corrupted archive longer than fallback"),
        "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\npartial".to_owned(),
        format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", MAX_DOWNLOAD_BYTES + 1),
        "HTTP/1.1 302 Found\r\nLocation: https://untrusted.example/runtime\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_owned(),
    ] {
        let (result, requests, bytes) = download(vec![failed, response("200 OK", "verified")]).await;
        assert!(result.is_ok(), "fallback failed: {result:?}");
        assert_eq!(requests, ["GET /mirror HTTP/1.1", "GET /official HTTP/1.1"]);
        assert_eq!(bytes, b"verified");
    }
}

#[tokio::test]
async fn invalid_official_archive_should_still_fail_integrity_validation() {
    let (result, requests, _) = download(vec![
        response("503 Service Unavailable", ""),
        response("200 OK", "corrupted"),
    ])
    .await;
    assert!(matches!(result, Err(RuntimeInstallError::Integrity)));
    assert_eq!(requests.len(), 2);
}

#[test]
fn redirects_should_only_accept_trusted_https_download_hosts() {
    for url in [
        "https://registry.npmmirror.com/pkg",
        "https://cdn.npmmirror.com/packages/pkg",
        "https://registry.npmjs.org/pkg",
    ] {
        assert!(trusted_download_url(&Url::parse(url).unwrap()));
    }
    for url in [
        "http://cdn.npmmirror.com/pkg",
        "https://cdn.npmmirror.com.evil.example/pkg",
        "https://cdn.npmmirror.com:444/pkg",
        "https://user@cdn.npmmirror.com/pkg",
        "https://127.0.0.1/pkg",
    ] {
        assert!(!trusted_download_url(&Url::parse(url).unwrap()));
    }
}

#[tokio::test]
#[ignore = "requires npm mirror network access"]
async fn live_mirror_archive_should_pass_the_pinned_official_integrity() {
    let distribution = super::super::runtime_manager::distribution_for(
        std::env::consts::OS,
        std::env::consts::ARCH,
    )
    .unwrap();
    let root = std::env::temp_dir().join(format!(
        "codeagent-live-download-{}-{}",
        std::process::id(),
        TEST_ID.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).await.unwrap();
    let archive = root.join("runtime.tgz");
    let on_progress = |_| {};
    let mut progress = DownloadProgressReporter::new(&on_progress, None);
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .read_timeout(Duration::from_secs(15))
        .redirect(download_redirect_policy())
        .build()
        .unwrap();
    let started = Instant::now();
    let result = download_source(
        &client,
        distribution.url,
        distribution.integrity,
        &archive,
        &mut progress,
        MIRROR_TIMEOUT,
    )
    .await;
    let bytes = fs::metadata(&archive)
        .await
        .map_or(0, |metadata| metadata.len());
    fs::remove_dir_all(&root).await.unwrap();
    assert!(result.is_ok(), "live mirror download failed: {result:?}");
    eprintln!(
        "Verified mirror archive: {bytes} bytes in {:?}",
        started.elapsed()
    );
}
