mod child;
mod commands;
mod config;
mod error;
mod http;
mod logging;
mod mcp;
mod native;
mod session;

use std::{path::PathBuf, sync::Arc};

use anyhow::Context;
use clap::{Parser, Subcommand};

use crate::{config::Config, session::SessionManager};

#[derive(Parser)]
#[command(name = "vmfarmd", version, about = "Testinator VM farm daemon")]
struct Cli {
    #[command(subcommand)]
    mode: Mode,
}

#[derive(Subcommand)]
enum Mode {
    /// Runs in the logged-in user's desktop session: hosts the MCP servers and the local API.
    Desktop {
        #[arg(long, default_value_os_t = config::default_path())]
        config: PathBuf,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    match Cli::parse().mode {
        Mode::Desktop { config } => run_desktop(Config::load(&config)?).await,
    }
}

async fn run_desktop(config: Config) -> anyhow::Result<()> {
    let config = Arc::new(config);
    let _log_guard = logging::init(config.log_dir.as_deref())?;
    if !config.listen.ip().is_loopback() {
        tracing::warn!(listen = %config.listen, "listening beyond loopback without authentication");
    }

    let sessions = Arc::new(SessionManager::new(Arc::clone(&config)));
    let reaper = sessions.spawn_idle_reaper();
    let listener = tokio::net::TcpListener::bind(config.listen)
        .await
        .with_context(|| format!("binding {}", config.listen))?;
    tracing::info!(listen = %config.listen, "vmfarmd listening");

    axum::serve(listener, http::router(Arc::clone(&sessions), &config))
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    reaper.abort();
    sessions.end_all().await;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
