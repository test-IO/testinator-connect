use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use serde_json::{Value, json};

use crate::{
    commands::{self, Command},
    config::Config,
    error::DaemonError,
    mcp::McpFrontend,
    session::SessionManager,
};

pub fn router(sessions: Arc<SessionManager>, config: &Config) -> Router {
    let mcp_config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_allowed_hosts(allowed_hosts(config));
    let frontend_sessions = Arc::clone(&sessions);
    let mcp = StreamableHttpService::new(
        move || Ok(McpFrontend::new(Arc::clone(&frontend_sessions))),
        Arc::new(LocalSessionManager::default()),
        mcp_config,
    );

    Router::new()
        .route("/health", get(health))
        .route("/control", post(control))
        .nest_service("/mcp", mcp)
        .with_state(sessions)
}

fn allowed_hosts(config: &Config) -> Vec<String> {
    let mut hosts: Vec<String> = ["localhost", "127.0.0.1", "::1"].map(String::from).into();
    let ip = config.listen.ip();
    if !ip.is_loopback() && !ip.is_unspecified() {
        hosts.push(ip.to_string());
    }
    hosts
}

async fn health(State(sessions): State<Arc<SessionManager>>) -> Json<Value> {
    Json(commands::health(&sessions).await)
}

async fn control(
    State(sessions): State<Arc<SessionManager>>,
    Json(command): Json<Command>,
) -> Result<Json<Value>, DaemonError> {
    let result = commands::execute(&sessions, command).await?;
    Ok(Json(json!({ "ok": true, "result": result })))
}
