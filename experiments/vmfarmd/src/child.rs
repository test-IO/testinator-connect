use std::{
    process::Stdio,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use process_wrap::tokio::{CommandWrap, KillOnDrop};
#[cfg(windows)]
use process_wrap::tokio::JobObject;
#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
use rmcp::{
    RoleClient, ServiceExt,
    service::{Peer, RunningService},
    transport::TokioChildProcess,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::ChildStderr,
    sync::Mutex,
};

use crate::{config::ServerSpec, error::DaemonError};

/// One MCP server process owned by one session.
pub struct McpChild {
    name: String,
    spec: ServerSpec,
    startup_timeout: Duration,
    running: Mutex<Option<RunningService<RoleClient, ()>>>,
    generation: AtomicU64,
}

impl McpChild {
    pub fn new(name: String, spec: ServerSpec, startup_timeout: Duration) -> Self {
        Self {
            name,
            spec,
            startup_timeout,
            running: Mutex::new(None),
            generation: AtomicU64::new(0),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Counts spawns, so callers can tell when the process behind a peer was replaced.
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    /// Returns a peer for the live process, spawning it only if it is not running.
    ///
    /// A failed call never triggers a respawn: the server owns the apps it launched,
    /// and a new process would lose them.
    pub async fn peer(&self) -> Result<Peer<RoleClient>, DaemonError> {
        let mut running = self.running.lock().await;
        if let Some(service) = running.as_ref() {
            if !service.is_closed() {
                return Ok(service.peer().clone());
            }
            tracing::warn!(server = %self.name, "MCP server exited; starting it again");
        }

        let service = tokio::time::timeout(self.startup_timeout, self.spawn())
            .await
            .map_err(|_| DaemonError::Timeout(format!("starting MCP server {}", self.name)))??;
        let peer = service.peer().clone();
        *running = Some(service);
        self.generation.fetch_add(1, Ordering::AcqRel);
        Ok(peer)
    }

    async fn spawn(&self) -> Result<RunningService<RoleClient, ()>, DaemonError> {
        let mut command = CommandWrap::with_new(&self.spec.command, |cmd| {
            cmd.args(&self.spec.args).envs(&self.spec.env);
            if let Some(cwd) = &self.spec.cwd {
                cmd.current_dir(cwd);
            }
        });
        #[cfg(unix)]
        command.wrap(ProcessGroup::leader());
        #[cfg(windows)]
        command.wrap(JobObject);
        command.wrap(KillOnDrop);

        let (transport, stderr) = TokioChildProcess::builder(command)
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|source| DaemonError::Spawn {
                server: self.name.clone(),
                source,
            })?;
        if let Some(stderr) = stderr {
            tokio::spawn(forward_stderr(self.name.clone(), stderr));
        }
        tracing::info!(server = %self.name, command = %self.spec.command, "started MCP server");

        ().serve(transport)
            .await
            .map_err(|error| DaemonError::mcp(&self.name, error))
    }

    pub async fn shutdown(&self) {
        if let Some(service) = self.running.lock().await.take() {
            if let Err(error) = service.cancel().await {
                tracing::warn!(server = %self.name, %error, "MCP server did not shut down cleanly");
            }
        }
    }
}

async fn forward_stderr(server: String, stderr: ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        tracing::info!(target: "mcp_stderr", server = %server, "{line}");
    }
}
