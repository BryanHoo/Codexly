//! 应用出口配置只在启动时加载；客户端连接池与引擎环境共用同一快照，保存不打断运行中的会话。
use reqwest::{ClientBuilder, Proxy, Url};
use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path, sync::OnceLock};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub mode: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            mode: "system".into(),
            protocol: "http".into(),
            host: String::new(),
            port: 8080,
            username: String::new(),
            password: None,
        }
    }
}
static ACTIVE: OnceLock<Settings> = OnceLock::new();
fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "代理配置无效")
}
impl Settings {
    pub fn url(&self) -> io::Result<Option<Url>> {
        if !["system", "direct", "custom"].contains(&self.mode.as_str())
            || !["http", "https", "socks5"].contains(&self.protocol.as_str())
            || self.port == 0
            || self.host.len() > 253
            || self.username.len() > 1024
            || self.password.as_ref().is_some_and(|p| p.len() > 1024)
        {
            return Err(invalid());
        }
        if self.mode != "custom" {
            return Ok(None);
        }
        let host = self
            .host
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']');
        if host.is_empty()
            || host
                .chars()
                .any(|c| c.is_whitespace() || "/@?#\\".contains(c))
        {
            return Err(invalid());
        }
        let host = if host.contains(':') {
            format!("[{host}]")
        } else {
            host.to_owned()
        };
        // SOCKS5 将域名交给代理解析，避免本机 DNS 泄露及污染。
        let scheme = if self.protocol == "socks5" {
            "socks5h"
        } else {
            &self.protocol
        };
        let mut url =
            Url::parse(&format!("{scheme}://{host}:{}", self.port)).map_err(|_| invalid())?;
        if url.host_str().is_none() {
            return Err(invalid());
        }
        url.set_username(&self.username).map_err(|()| invalid())?;
        if let Some(password) = &self.password {
            url.set_password(Some(password)).map_err(|()| invalid())?;
        }
        Ok(Some(url))
    }
}
pub fn load(directory: &Path) -> io::Result<Settings> {
    let settings: Settings = match fs::read(directory.join("network-proxy.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| invalid())?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => Settings::default(),
        Err(_) => return Err(io::Error::other("无法读取网络代理配置")),
    };
    settings.url()?;
    Ok(settings)
}
pub fn initialize(directory: &Path) -> io::Result<()> {
    let _ = ACTIVE.set(load(directory)?);
    Ok(())
}
pub fn status(settings: &Settings) -> serde_json::Value {
    serde_json::json!({"mode":settings.mode,"protocol":settings.protocol,"host":settings.host,"port":settings.port,"username":settings.username,"hasPassword":settings.password.as_ref().is_some_and(|p| !p.is_empty())})
}
pub fn save(directory: &Path, mut settings: Settings) -> io::Result<serde_json::Value> {
    settings.url()?;
    if settings.password.is_none() {
        settings.password = load(directory)?.password;
    }
    let bytes = serde_json::to_vec(&settings).map_err(|_| invalid())?;
    super::atomic_file::write_with(&directory.join("network-proxy.json"), |file| {
        use std::io::Write;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        file.write_all(&bytes)
    })?;
    Ok(status(&settings))
}
pub fn configure(builder: ClientBuilder, settings: &Settings) -> ClientBuilder {
    match settings.mode.as_str() {
        "direct" => builder.no_proxy(),
        "custom" => {
            // 此处配置已在启动/测试边界验证；无效配置绝不能降级为直连。
            let url = settings
                .url()
                .expect("validated proxy settings")
                .expect("custom proxy URL");
            let proxy = Proxy::all(url)
                .expect("validated proxy URL")
                .no_proxy(reqwest::NoProxy::from_string("localhost,127.0.0.1,::1"));
            builder.no_proxy().proxy(proxy)
        }
        _ => builder,
    }
}
pub fn client_builder() -> ClientBuilder {
    configure(
        reqwest::Client::builder(),
        ACTIVE.get().unwrap_or(&Settings::default()),
    )
}
pub fn apply_command(command: &mut tokio::process::Command) {
    let Some(settings) = ACTIVE.get() else {
        return;
    };
    if settings.mode == "system" {
        return;
    }
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "no_proxy",
    ] {
        command.env_remove(key);
    }
    if settings.mode == "direct" {
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            command.env(key, "");
        }
        command.env("NO_PROXY", "*").env("no_proxy", "*");
    }
    if let Some(url) = settings.url().expect("validated proxy settings") {
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            command.env(key, url.as_str());
        }
        command
            .env("NO_PROXY", "localhost,127.0.0.1,::1")
            .env("no_proxy", "localhost,127.0.0.1,::1");
    }
}
pub fn updater(
    app: &tauri::AppHandle,
) -> tauri_plugin_updater::Result<tauri_plugin_updater::Updater> {
    use tauri_plugin_updater::UpdaterExt;
    let mut builder = app.updater_builder();
    if let Some(settings) = ACTIVE.get() {
        if settings.mode == "direct" {
            builder = builder.no_proxy();
        } else if let Some(url) = settings.url().expect("validated proxy settings") {
            builder = builder.proxy(url);
        }
    }
    builder.build()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn network_proxy_persistence_redacts_and_preserves_password() {
        let root = tempfile::tempdir().unwrap();
        let mut settings = Settings {
            mode: "custom".into(),
            protocol: "socks5".into(),
            host: "::1".into(),
            username: "a@b".into(),
            password: Some("p:/".into()),
            ..Settings::default()
        };
        assert!(
            settings
                .url()
                .unwrap()
                .unwrap()
                .as_str()
                .contains("a%40b:p%3A%2F@")
        );
        assert!(
            save(root.path(), settings.clone())
                .unwrap()
                .get("password")
                .is_none()
        );
        settings.password = None;
        save(root.path(), settings.clone()).unwrap();
        assert_eq!(load(root.path()).unwrap().password.as_deref(), Some("p:/"));
        settings.password = Some(String::new());
        save(root.path(), settings).unwrap();
        assert_eq!(status(&load(root.path()).unwrap())["hasPassword"], false);
    }
    #[test]
    fn network_proxy_rejects_invalid_gateway() {
        let settings = Settings {
            mode: "custom".into(),
            host: "user:secret@host".into(),
            ..Settings::default()
        };
        assert_eq!(settings.url().unwrap_err().to_string(), "代理配置无效");
    }
}

/// 宿主延迟启动也必须使用应用启动时的快照，避免保存设置后两种引擎使用不同出口。
pub fn configure_claude_host(command: &mut tokio::process::Command) {
    apply_command(command);
    if let Some(settings) = ACTIVE.get() {
        command.env(
            "CODEXLY_NETWORK_PROXY_SNAPSHOT",
            serde_json::to_string(settings).expect("serializable proxy settings"),
        );
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn network_proxy_http_routes_and_authenticates_without_resolving_target() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let gateway = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![0; 8192];
            let size = socket.read(&mut bytes).await.unwrap();
            let request = String::from_utf8_lossy(&bytes[..size]).to_lowercase();
            assert!(request.contains("http://destination.invalid/"));
            assert!(request.contains("proxy-authorization: basic dxnlcjpzzwnyzxq="));
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied",
                )
                .await
                .unwrap();
        });
        let settings = Settings {
            mode: "custom".into(),
            host: "127.0.0.1".into(),
            port,
            username: "user".into(),
            password: Some("secret".into()),
            ..Settings::default()
        };
        let client = configure(reqwest::Client::builder(), &settings)
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        let response = client
            .get("http://destination.invalid/")
            .send()
            .await
            .unwrap();
        assert_eq!(response.text().await.unwrap(), "proxied");
        gateway.await.unwrap();
    }

    #[tokio::test]
    async fn network_proxy_socks_resolves_domain_at_gateway() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let gateway = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut greeting = [0; 2];
            socket.read_exact(&mut greeting).await.unwrap();
            let mut methods = vec![0; usize::from(greeting[1])];
            socket.read_exact(&mut methods).await.unwrap();
            socket.write_all(&[5, 0]).await.unwrap();
            let mut header = [0; 5];
            socket.read_exact(&mut header).await.unwrap();
            assert_eq!(header[3], 3);
            let mut target = vec![0; usize::from(header[4])];
            socket.read_exact(&mut target).await.unwrap();
            assert_eq!(target, b"destination.invalid");
            let mut target_port = [0; 2];
            socket.read_exact(&mut target_port).await.unwrap();
            socket
                .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 80])
                .await
                .unwrap();
            let mut request = [0; 8192];
            assert!(socket.read(&mut request).await.unwrap() > 0);
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nsocks",
                )
                .await
                .unwrap();
        });
        let settings = Settings {
            mode: "custom".into(),
            protocol: "socks5".into(),
            host: "127.0.0.1".into(),
            port,
            ..Settings::default()
        };
        let client = configure(reqwest::Client::builder(), &settings)
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        assert_eq!(
            client
                .get("http://destination.invalid/")
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "socks"
        );
        gateway.await.unwrap();
    }
}
