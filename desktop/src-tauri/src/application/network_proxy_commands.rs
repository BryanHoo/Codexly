use crate::infrastructure::{
    app_data,
    network_proxy::{self, Settings},
};
use serde_json::Value;
use tauri::AppHandle;

#[tauri::command]
pub async fn read_network_proxy(app: AppHandle) -> Result<Value, String> {
    let directory = app_data::directory(&app).map_err(|_| "无法读取网络代理配置")?;
    tokio::task::spawn_blocking(move || {
        network_proxy::load(&directory).map(|settings| network_proxy::status(&settings))
    })
    .await
    .map_err(|_| "无法读取网络代理配置")?
    .map_err(|_| "无法读取网络代理配置".into())
}
#[tauri::command]
pub async fn save_network_proxy(app: AppHandle, settings: Settings) -> Result<Value, String> {
    let directory = app_data::directory(&app).map_err(|_| "无法保存网络代理配置")?;
    tokio::task::spawn_blocking(move || network_proxy::save(&directory, settings))
        .await
        .map_err(|_| "无法保存网络代理配置")?
        .map_err(|_| "代理配置保存失败，请检查配置".into())
}
#[tauri::command]
pub async fn test_network_proxy(app: AppHandle, mut settings: Settings) -> Result<(), String> {
    let error = || "代理连接测试失败，请检查网关、认证和网络".to_owned();
    settings.url().map_err(|_| error())?;
    if settings.password.is_none() {
        let directory = app_data::directory(&app).map_err(|_| error())?;
        settings.password = tokio::task::spawn_blocking(move || network_proxy::load(&directory))
            .await
            .map_err(|_| error())?
            .map_err(|_| error())?
            .password;
    }
    // 独立客户端仅用于测试草稿，不修改全局配置或正在运行的引擎。
    let response = network_proxy::configure(reqwest::Client::builder(), &settings)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| error())?
        .head("https://example.com")
        .send()
        .await
        .map_err(|_| error())?;
    if !response.status().is_success() {
        return Err(error());
    }
    Ok(())
}
